import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { CUT_MODE_LEFT_ONLY, effectiveCutCount } from '../lib/cutJob'
import {
  OVERLAY_GRID_BINS,
  OVERLAY_COLORS,
  buildCutPath,
  extractOverlayContour,
  buildOverlayAnnotations,
  projectedBlockWidth,
  blockCenterU,
} from '../lib/cutOverlay'

// Quality is fixed at High (600 grid bins) for the Stage 1 preview.
const GRID_BINS = OVERLAY_GRID_BINS

// Zoom/pan limits for the 2D preview.
const MIN_ZOOM = 0.5
const MAX_ZOOM = 10

// Experimental Sim module — 2D panel only, deliberately not in the shared
// overlay colour set so the Combined view is untouched.
// Next-rotation start point: white fill inside a blue outer stroke with a
// yellow inner stroke. 9px rather than the 7px direction markers — two strokes
// do not read at 7px.
const SIM_DOT_SIZE = 9
const SIM_DOT_FILL = '#ffffff'
const SIM_DOT_OUTER = '#1d5cff'
const SIM_DOT_INNER = '#facc15'
// Cutting-wire marker: translucent glow + bright core, blinking.
const WIRE_GLOW_R = 8
const WIRE_CORE_R = 3.5
const WIRE_GLOW_COLOR = '#ff4500'
const WIRE_CORE_COLOR = '#fff7ed'
const WIRE_BLINK_PERIOD = 0.45
// Fixed playback duration for one full wire travel (lead-in + cut + lead-out),
// held at the end.
const SIM_PLAY_SECONDS = 4
// Matches cutOverlay.js's MARKER_SIZE so the Sim dot is the same size as the
// green/red direction markers.
const MARKER_SIZE = 7

/**
 * Point at normalised arc-length `frac` (0..1) along a polyline. Sampling by
 * length rather than by vertex index keeps the wire marker's speed uniform
 * where the contour's vertices bunch up.
 *
 * @param {{u:number,v:number}[]} pts
 * @param {number} frac
 */
function pointAtFraction(pts, frac) {
  if (!pts?.length) return null
  if (pts.length === 1) return pts[0]
  const segLen = []
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].u - pts[i - 1].u, pts[i].v - pts[i - 1].v)
    segLen.push(d)
    total += d
  }
  if (total <= 0) return pts[0]
  let target = Math.min(1, Math.max(0, frac)) * total
  for (let i = 0; i < segLen.length; i++) {
    if (target <= segLen[i] || i === segLen.length - 1) {
      const t = segLen[i] > 0 ? target / segLen[i] : 0
      return {
        u: pts[i].u + t * (pts[i + 1].u - pts[i].u),
        v: pts[i].v + t * (pts[i + 1].v - pts[i].v),
      }
    }
    target -= segLen[i]
  }
  return pts[pts.length - 1]
}

/**
 * The wire's full travel for one rotation, as one polyline:
 * green safe point → lead-in → cut path → lead-out → red safe point.
 *
 * The lead-in / lead-out segments are the drawn link lines; the green one
 * always ends on one end of the cut path and the red one begins at the other,
 * so orienting the cut path by which end the green link attaches to makes the
 * movement follow green → red on both parities. The cut path array itself is
 * never modified.
 *
 * @param {{u:number,v:number}[]} cutPath
 * @param {{from:{u:number,v:number}, to:{u:number,v:number}, color:string}[]} links
 * @param {{green:string, red:string}} colors
 */
function buildFullWirePath(cutPath, links, colors) {
  if (!cutPath?.length) return []
  const green = links.find((l) => l.color === colors.green)
  const red = links.find((l) => l.color === colors.red)
  if (!green || !red) return cutPath

  // Walk the cut path from whichever end the green lead-in lands on.
  const distToStart = Math.hypot(
    green.to.u - cutPath[0].u, green.to.v - cutPath[0].v,
  )
  const last = cutPath[cutPath.length - 1]
  const distToEnd = Math.hypot(green.to.u - last.u, green.to.v - last.v)
  const cut = distToStart <= distToEnd ? cutPath : [...cutPath].reverse()

  return [green.from, green.to, ...cut.slice(1), red.to]
}

/**
 * Stage 1 two-dimensional silhouette preview — DevFoam-style, synced to the
 * app's shared rotation state.
 *
 * Renders the raw closed shadow loop for the CURRENT rotation step (thetaDeg)
 * as a dashed black polyline at 50% opacity on a light background. Coordinate
 * system: Y up, origin bottom-left. No block boundary, no frame, no clamp, no
 * safe points.
 * Two dashed reference axes are drawn behind the silhouette: a red vertical
 * line at u = 0 (rotation axis) and a blue horizontal line at v = BO, the
 * bottom cutout offset where the wire stops cutting.
 * A solid blue polyline on top marks the cut path: from the left-hand BO
 * crossing, over the top of the silhouette, to the right-hand BO crossing
 * (left→right mode) or stopping at the top of the u = 0 axis (left-only).
 *
 * The panel is driven by the same thetaDeg as the 3D view (via the shared
 * cutIndex/cutCount in the bottom navigation bar), so stepping rotations keeps
 * both views in lock-step.
 */
export default function SilhouettePreviewPanel({
  geometry,
  thetaDeg,
  cutIndex = 0,
  cutMode,
  stock,
  simActive = false,
  simPlaying = false,
  rotationN,
}) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)

  // Zoom/pan transform state. Pan is in screen pixels; zoom is a linear scale.
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef(null) // { x, y, pointerId }
  const pinchRef = useRef(null) // { startDist, startZoom, cx, cy }
  // Sim playback progress along the cut path, 0..1. Held in a ref (not state)
  // so the animation loop can drive the canvas without re-rendering React on
  // every frame; `simDrawRef` lets the loop call the current draw closure.
  const simProgressRef = useRef(0)
  const simDrawRef = useRef(() => {})
  const simRafRef = useRef(null)

  const setTransform = useCallback((nextZoom, nextPan) => {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom))
    zoomRef.current = z
    panRef.current = nextPan
    setZoom(z)
    setPan(nextPan)
  }, [])

  const resetView = useCallback(() => {
    setTransform(1, { x: 0, y: 0 })
  }, [setTransform])

  const contour = useMemo(
    () => extractOverlayContour(geometry, thetaDeg),
    [geometry, thetaDeg],
  )

  const cutPath = useMemo(
    () => buildCutPath(contour, stock?.bo ?? 0, cutMode === CUT_MODE_LEFT_ONLY),
    [contour, stock?.bo, cutMode],
  )

  const annotations = useMemo(
    () => buildOverlayAnnotations({ cutPath, cutMode, stock, cutIndex, geometry, thetaDeg }),
    [cutPath, cutMode, stock, cutIndex, geometry, thetaDeg],
  )

  // Experimental Sim — the full wire travel for this rotation, used only by the
  // animation. Derived from the drawn link lines, so no geometry is recomputed
  // and neither cutPath nor the rendering changes.
  const fullWirePath = useMemo(
    () => buildFullWirePath(cutPath, annotations.links, OVERLAY_COLORS),
    [cutPath, annotations.links],
  )

  // Experimental Sim: the next rotation's cut-entry point, drawn in the current
  // view. The step is one full cutCount revolution step, so it is 360/cutCount
  // in both cut modes. Suppressed on the last rotation — there is no next.
  const simDot = useMemo(() => {
    if (!simActive || !geometry) return null
    const count = effectiveCutCount(rotationN ?? 0, { mode: cutMode })
    if (!count || cutIndex >= count - 1) return null
    const thetaNext = thetaDeg + 360 / count
    const uCenterNext = blockCenterU(geometry, thetaNext)
    const projectedNext = projectedBlockWidth(thetaNext, stock)
    return {
      u: uCenterNext - projectedNext / 2 - (stock?.boMargin ?? 20),
      v: stock?.bo ?? 0,
    }
  }, [simActive, geometry, rotationN, cutMode, cutIndex, thetaDeg, stock])

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const draw = () => {
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      if (w < 10 || h < 10) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      const ctx = canvas.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#f4f6f8'
      ctx.fillRect(0, 0, w, h)

      if (!contour.length) {
        ctx.fillStyle = '#8892a0'
        ctx.font = '13px system-ui'
        ctx.textAlign = 'center'
        ctx.fillText('No silhouette at this angle', w / 2, h / 2)
        return
      }

      const z = zoomRef.current
      const pn = panRef.current

      // Stock-based constant scale (foam block size, NOT silhouette bbox).
      // u = 0 is anchored at canvas centre (w/2); v = 0 near the bottom (0.8h).
      // The silhouette renders at its true position relative to the axis.
      const stockExtent = Math.max(stock?.w ?? 1, stock?.t ?? 1, stock?.h ?? 1, 1)
      const baseScale = (Math.min(w, h) * 0.7) / stockExtent

      const scale = baseScale * z
      const X = (u) => w / 2 + u * scale + pn.x
      const Y = (v) => h * 0.8 - v * scale + pn.y

      // Reference axes — world origin guides, drawn behind the silhouette.
      const boV = stock?.bo ?? 0
      const axisX = X(0)
      ctx.setLineDash([6, 5])
      ctx.lineWidth = 1
      ctx.strokeStyle = '#ff0000'
      ctx.beginPath()
      ctx.moveTo(axisX, 0)
      ctx.lineTo(axisX, h)
      ctx.stroke()
      const boY = Y(boV)
      ctx.strokeStyle = '#6ea8ff'
      ctx.beginPath()
      ctx.moveTo(0, boY)
      ctx.lineTo(w, boY)
      ctx.stroke()
      ctx.setLineDash([])

      // Foam block outline — dynamic projected width, centred on the MODEL's
      // projected 3D-bbox centre (not on the rotation axis). Same numbers the
      // 3D Combined overlay draws. Dashed grey, thin, no fill, behind the
      // silhouette.
      const { block } = annotations
      ctx.strokeStyle = '#8a9099'
      ctx.globalAlpha = 0.4
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.strokeRect(
        X(block.leftU), Y(block.topV),
        X(block.rightU) - X(block.leftU), Y(block.bottomV) - Y(block.topV),
      )
      ctx.setLineDash([])
      ctx.globalAlpha = 1

      // Silhouette outline — dashed, 50% opacity.
      ctx.setLineDash([5, 4])
      ctx.strokeStyle = '#000000'
      ctx.globalAlpha = 0.5
      ctx.lineWidth = 1.6
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(X(contour[0].u), Y(contour[0].v))
      for (let i = 1; i < contour.length; i++) ctx.lineTo(X(contour[i].u), Y(contour[i].v))
      ctx.closePath()
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.setLineDash([])

      // Cut path
      if (cutPath.length >= 2) {
        ctx.strokeStyle = '#1d5cff'
        ctx.lineWidth = 2
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(X(cutPath[0].u), Y(cutPath[0].v))
        for (let i = 1; i < cutPath.length; i++) ctx.lineTo(X(cutPath[i].u), Y(cutPath[i].v))
        ctx.stroke()
      }

      // Cut-entry / cut-exit markers + lead-in / lead-out link lines.
      // Positions and colours come from the shared overlay module, so the 3D
      // Combined view draws the identical drawing on the fixed MP plane.
      const drawMarkerAt = (px, py, color, dark, size) => {
        ctx.fillStyle = color
        ctx.strokeStyle = dark
        ctx.lineWidth = 1
        ctx.fillRect(px - size / 2, py - size / 2, size, size)
        ctx.strokeRect(px - size / 2, py - size / 2, size, size)
      }

      const drawLink = (x1, y1, x2, y2, color) => {
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()
      }

      for (const link of annotations.links) {
        drawLink(X(link.from.u), Y(link.from.v), X(link.to.u), Y(link.to.v), link.color)
      }
      for (const m of annotations.markers) {
        drawMarkerAt(X(m.u), Y(m.v), m.color, m.dark, m.size)
      }

      // Experimental Sim — the next rotation's start point, drawn last so it
      // sits on top of every other element. Three strokes on a 9px square:
      // blue outer, 1px gap, yellow inner, white fill.
      if (simDot) {
        const s = SIM_DOT_SIZE
        ctx.fillStyle = SIM_DOT_FILL
        ctx.fillRect(X(simDot.u) - s / 2, Y(simDot.v) - s / 2, s, s)
        ctx.strokeStyle = SIM_DOT_OUTER
        ctx.lineWidth = 1
        ctx.strokeRect(X(simDot.u) - s / 2, Y(simDot.v) - s / 2, s, s)
        const ins = 2
        ctx.strokeStyle = SIM_DOT_INNER
        ctx.strokeRect(
          X(simDot.u) - s / 2 + ins, Y(simDot.v) - s / 2 + ins,
          s - 2 * ins, s - 2 * ins,
        )
      }

      // Experimental Sim — the hot wire tip travelling the current rotation's
      // full travel: green safe point → lead-in → cut path → lead-out → red
      // safe point, as one continuous motion. Screen-space radii (does not
      // scale with zoom). The blink is driven off wall-clock time so it stays
      // steady regardless of frame rate.
      if (simActive && fullWirePath.length >= 2) {
        const wirePt = pointAtFraction(fullWirePath, simProgressRef.current)
        if (wirePt) {
          const wx = X(wirePt.u)
          const wy = Y(wirePt.v)
          const t = (Date.now() / 1000) % WIRE_BLINK_PERIOD
          const phase = Math.sin((t / WIRE_BLINK_PERIOD) * Math.PI * 2)
          const opacity = 0.5 + 0.45 * phase

          // Soft halo — a radial gradient standing in for a drop shadow.
          const halo = ctx.createRadialGradient(wx, wy, 0, wx, wy, WIRE_GLOW_R * 2)
          halo.addColorStop(0, WIRE_GLOW_COLOR)
          halo.addColorStop(1, 'rgba(255, 69, 0, 0)')
          ctx.globalAlpha = Math.max(0, opacity * 0.45)
          ctx.fillStyle = halo
          ctx.beginPath()
          ctx.arc(wx, wy, WIRE_GLOW_R * 2, 0, Math.PI * 2)
          ctx.fill()

          ctx.globalAlpha = Math.max(0, opacity)
          ctx.fillStyle = WIRE_GLOW_COLOR
          ctx.beginPath()
          ctx.arc(wx, wy, WIRE_GLOW_R, 0, Math.PI * 2)
          ctx.fill()

          ctx.fillStyle = WIRE_CORE_COLOR
          ctx.beginPath()
          ctx.arc(wx, wy, WIRE_CORE_R, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = 1
        }
      }
    }

    simDrawRef.current = draw
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)

    return () => ro.disconnect()
  }, [contour, cutPath, fullWirePath, annotations, stock, cutIndex, cutMode, thetaDeg, zoom, pan, simDot, simActive])

  // Sim playback: advance the wire marker along the full travel over a fixed
  // duration, then hold at the end. Only this loop repaints — everything else
  // in the panel still redraws on state change. Progress is reset whenever the
  // path or the previewed rotation changes, so ◀ ▶ restarts the scene.
  useEffect(() => {
    if (!simPlaying || fullWirePath.length < 2) return undefined
    let start = null
    const step = (now) => {
      if (start == null) start = now
      const frac = Math.min(1, (now - start) / (SIM_PLAY_SECONDS * 1000))
      simProgressRef.current = frac
      simDrawRef.current()
      if (frac < 1) simRafRef.current = requestAnimationFrame(step)
      else simRafRef.current = null
    }
    simRafRef.current = requestAnimationFrame(step)
    return () => {
      if (simRafRef.current) cancelAnimationFrame(simRafRef.current)
      simRafRef.current = null
    }
  }, [simPlaying, fullWirePath])

  useEffect(() => {
    simProgressRef.current = 0
    simDrawRef.current()
  }, [fullWirePath, cutIndex, simActive])

  // Zoom / pan interaction handlers (wheel, pointer drag, pinch).
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const zoomAt = (clientX, clientY, factor) => {
      const rect = wrap.getBoundingClientRect()
      const z = zoomRef.current
      const nextZ = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor))
      if (nextZ === z) return
      // Keep the point under the cursor fixed while zooming.
      const cx = clientX - rect.left
      const cy = clientY - rect.top
      const pn = panRef.current
      const nextPan = {
        x: cx - (cx - pn.x) * (nextZ / z),
        y: cy - (cy - pn.y) * (nextZ / z),
      }
      setTransform(nextZ, nextPan)
    }

    const onWheel = (e) => {
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.0015)
      zoomAt(e.clientX, e.clientY, factor)
    }

    const onPointerDown = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      dragRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId }
      wrap.setPointerCapture(e.pointerId)
      wrap.classList.add('is-panning')
    }

    const onPointerMove = (e) => {
      const d = dragRef.current
      if (!d || d.pointerId !== e.pointerId) return
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      d.x = e.clientX
      d.y = e.clientY
      const pn = panRef.current
      setTransform(zoomRef.current, { x: pn.x + dx, y: pn.y + dy })
    }

    const endPan = (e) => {
      const d = dragRef.current
      if (!d) return
      if (e && e.pointerId && d.pointerId !== e.pointerId) return
      dragRef.current = null
      wrap.classList.remove('is-panning')
      if (e && e.pointerId != null) {
        try { wrap.releasePointerCapture(e.pointerId) } catch (_) {}
      }
    }

    // Pinch (two-finger) zoom for touch.
    const touchDist = (touches) => Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY,
    )

    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        e.preventDefault()
        const rect = wrap.getBoundingClientRect()
        pinchRef.current = {
          startDist: touchDist(e.touches),
          startZoom: zoomRef.current,
          cx: (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left,
          cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top,
        }
      }
    }

    const onTouchMove = (e) => {
      const p = pinchRef.current
      if (p && e.touches.length === 2) {
        e.preventDefault()
        const dist = touchDist(e.touches)
        if (p.startDist < 1) return
        const factor = dist / p.startDist
        const nextZ = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, p.startZoom * factor))
        const pn = panRef.current
        // Keep pinch centre fixed.
        const nextPan = {
          x: p.cx - (p.cx - pn.x) * (nextZ / zoomRef.current),
          y: p.cy - (p.cy - pn.y) * (nextZ / zoomRef.current),
        }
        setTransform(nextZ, nextPan)
      }
    }

    const onTouchEnd = (e) => {
      if (e.touches.length < 2) pinchRef.current = null
    }

    const onDoubleClick = () => resetView()

    wrap.addEventListener('wheel', onWheel, { passive: false })
    wrap.addEventListener('pointerdown', onPointerDown)
    wrap.addEventListener('pointermove', onPointerMove)
    wrap.addEventListener('pointerup', endPan)
    wrap.addEventListener('pointercancel', endPan)
    wrap.addEventListener('touchstart', onTouchStart, { passive: false })
    wrap.addEventListener('touchmove', onTouchMove, { passive: false })
    wrap.addEventListener('touchend', onTouchEnd)
    wrap.addEventListener('touchcancel', onTouchEnd)
    wrap.addEventListener('dblclick', onDoubleClick)

    return () => {
      wrap.removeEventListener('wheel', onWheel)
      wrap.removeEventListener('pointerdown', onPointerDown)
      wrap.removeEventListener('pointermove', onPointerMove)
      wrap.removeEventListener('pointerup', endPan)
      wrap.removeEventListener('pointercancel', endPan)
      wrap.removeEventListener('touchstart', onTouchStart)
      wrap.removeEventListener('touchmove', onTouchMove)
      wrap.removeEventListener('touchend', onTouchEnd)
      wrap.removeEventListener('touchcancel', onTouchEnd)
      wrap.removeEventListener('dblclick', onDoubleClick)
    }
  }, [setTransform, resetView])

  return (
    <section className="silhouette-preview-section">
      <div className="section-label section-label-sub">2D Silhouette Preview (Stage 1)</div>

      <div className="preview-wrap silhouette-preview-canvas-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} />
        <div className="silhouette-zoom-controls">
          <button
            type="button"
            className="silhouette-zoom-btn"
            aria-label="Zoom in"
            onClick={() => setTransform(zoomRef.current * 1.25, panRef.current)}
          >
            +
          </button>
          <button
            type="button"
            className="silhouette-zoom-btn"
            aria-label="Zoom out"
            onClick={() => setTransform(zoomRef.current / 1.25, panRef.current)}
          >
            −
          </button>
          <button
            type="button"
            className="silhouette-zoom-btn silhouette-zoom-reset"
            aria-label="Reset zoom"
            onClick={resetView}
          >
            Reset
          </button>
        </div>
      </div>

      <div className="silhouette-preview-footer">
        {contour.length > 0 ? `${contour.length} pts · bins ${GRID_BINS} · ${(zoom * 100).toFixed(0)}%` : '—'}
      </div>
    </section>
  )
}

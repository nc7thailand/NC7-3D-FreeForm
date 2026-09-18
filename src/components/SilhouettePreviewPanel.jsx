import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { extractFullSilhouette } from '../lib/silhouette'
import { cuttingPlane, planePointMiddleFromStock } from '../lib/toolpath'
import { CUT_MODE_LEFT_ONLY } from '../lib/cutJob'

// Quality is fixed at High (600 grid bins) for the Stage 1 preview.
const GRID_BINS = 600

// Zoom/pan limits for the 2D preview.
const MIN_ZOOM = 0.5
const MAX_ZOOM = 10

/**
 * Interpolate where edge `a→b` crosses a constant value of `axis`.
 * Returns null when the edge does not cross (or is degenerate).
 */
function crossAt(a, b, axis, value) {
  const av = a[axis], bv = b[axis]
  if ((av - value) * (bv - value) >= 0) return null
  const t = (value - av) / (bv - av)
  return {
    u: a.u + t * (b.u - a.u),
    v: a.v + t * (b.v - a.v),
  }
}

/**
 * Build the open cut path for one rotation: the part of the closed silhouette
 * that the wire actually traces, starting and ending on the BO line (v = BO).
 *
 * The path is the arc that runs from the left-hand BO crossing, up and over the
 * top of the silhouette, to the right-hand BO crossing. The short arc under the
 * BO line is the workpiece's attachment base and is excluded. Both winding
 * directions are handled by keeping whichever arc reaches the greater height.
 *
 * In left-only mode the path walks the arc from the left BO crossing while
 * u <= 0 and stops at the first vertex past the rotation axis, cutting at the
 * interpolated u = 0 point. Vertices sitting exactly on u = 0 simply continue
 * the walk, so they need no special case.
 *
 * @param {{u:number,v:number}[]} contour - closed loop
 * @param {number} boV - BO level (v = BO)
 * @param {boolean} leftOnly - stop at the first u > 0 vertex
 * @returns {{u:number,v:number}[]} open polyline (empty when unavailable)
 */
function buildCutPath(contour, boV, leftOnly) {
  const n = contour.length
  if (n < 3) return []

  const leftCross = []   // u < 0
  const rightCross = []  // u > 0
  for (let i = 0; i < n; i++) {
    const a = contour[i]
    const b = contour[(i + 1) % n]
    const p = crossAt(a, b, 'v', boV)
    if (!p) continue
    if (p.u < 0) leftCross.push({ i, ...p })
    else if (p.u > 0) rightCross.push({ i, ...p })
  }
  if (!leftCross.length || !rightCross.length) return []

  // Walk the loop from one edge-index to another, always stepping +1.
  const walk = (fromEdge, toEdge, startPt, endPt) => {
    const pts = [{ u: startPt.u, v: startPt.v }]
    let i = (fromEdge + 1) % n
    let guard = 0
    while (guard++ <= n) {
      if (i === (toEdge + 1) % n) break
      pts.push(contour[i])
      i = (i + 1) % n
    }
    pts.push({ u: endPt.u, v: endPt.v })
    return pts
  }

  let best = null
  for (const l of leftCross) {
    for (const r of rightCross) {
      const arc = walk(l.i, r.i, l, r)
      let maxV = -Infinity
      for (const p of arc) if (p.v > maxV) maxV = p.v
      if (!best || maxV > best.maxV) best = { arc, maxV }
    }
  }
  if (!best) return []

  if (!leftOnly) return best.arc

  // Left-only: walk the arc from the left BO crossing while u <= 0 and cut at
  // the first vertex past the rotation axis. Walking by u-sign (rather than
  // detecting crossings) needs no special handling for vertices sitting exactly
  // on u = 0 or for near-tangent segments.
  const cut = best.arc[best.arc.length - 1]
  for (let i = 1; i < best.arc.length; i++) {
    const p = best.arc[i]
    if (p.u > 0) {
      const prev = best.arc[i - 1]
      const t = prev.u / (prev.u - p.u)
      const axis = { u: 0, v: prev.v + t * (p.v - prev.v) }
      return [...best.arc.slice(0, i), axis]
    }
  }

  // Never reached the axis: the kept half is undefined, so report it rather
  // than silently returning the full silhouette as if the cut had happened.
  console.warn('[SilhouettePreviewPanel] left-only cut found no u > 0 vertex', {
    arcPoints: best.arc.length,
    startU: best.arc[0].u,
    endU: cut.u,
    maxV: best.maxV,
  })
  return []
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

  const contour = useMemo(() => {
    if (!geometry) return []
    try {
      const frame = cuttingPlane(thetaDeg, planePointMiddleFromStock())
      return extractFullSilhouette(geometry, frame, { profileAccuracy: 5, gridBins: GRID_BINS })
    } catch (err) {
      console.warn('silhouette preview failed:', err)
      return []
    }
  }, [geometry, thetaDeg])

  const cutPath = useMemo(
    () => buildCutPath(contour, stock?.bo ?? 0, cutMode === CUT_MODE_LEFT_ONLY),
    [contour, stock?.bo, cutMode],
  )

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

      // Foam block outline — dynamic projected width as the block rotates.
      // projectedWidth(θ) = W·|cos θ| + T·|sin θ|, centred on u = 0, spanning
      // v ∈ [0, stock.h]. Dashed grey, thin, no fill, drawn behind the
      // silhouette and cut path.
      const rad = (thetaDeg * Math.PI) / 180
      const projectedW = (stock?.w ?? 0) * Math.abs(Math.cos(rad))
        + (stock?.t ?? 0) * Math.abs(Math.sin(rad))
      const blockLeftU = -projectedW / 2
      const blockRightU = projectedW / 2
      const blockTopV = stock?.h ?? 0
      ctx.strokeStyle = '#8a9099'
      ctx.globalAlpha = 0.4
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.strokeRect(X(blockLeftU), Y(blockTopV), X(blockRightU) - X(blockLeftU), Y(0) - Y(blockTopV))
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
      //
      // The wire alternates direction by rotation parity:
      //   odd  rotation (1,3,5,7): LEFT = green (start), RIGHT = red (end)  → left→right
      //   even rotation (2,4,6,8): LEFT = red   (end),   RIGHT = green (start) → right→left
      //
      // Markers sit OUTSIDE the foam block on each side at v = BO. The link
      // lines are horizontal (both markers and cut-path endpoints are at v=BO)
      // and join the green marker to the cut path's start endpoint and the cut
      // path's end endpoint to the red marker.
      const fallbackBoMargin = 20
      const bottomSafeOffset = stock?.boMargin ?? fallbackBoMargin
      const leftMarkerU = blockLeftU - bottomSafeOffset
      const rightMarkerU = blockRightU + bottomSafeOffset
      const markerV = boV
      const markerSize = 7
      const GREEN = '#22c55e'
      const GREEN_DARK = '#15803d'
      const RED = '#ef4444'
      const RED_DARK = '#b91c1c'

      const rotationNumber = cutIndex + 1
      const isOdd = rotationNumber % 2 === 1
      const leftColor = isOdd ? GREEN : RED
      const leftDark = isOdd ? GREEN_DARK : RED_DARK
      const rightColor = isOdd ? RED : GREEN
      const rightDark = isOdd ? RED_DARK : GREEN_DARK

      const drawMarker = (u, color, dark) => {
        const mx = X(u)
        const my = Y(markerV)
        ctx.fillStyle = color
        ctx.strokeStyle = dark
        ctx.lineWidth = 1
        ctx.fillRect(mx - markerSize / 2, my - markerSize / 2, markerSize, markerSize)
        ctx.strokeRect(mx - markerSize / 2, my - markerSize / 2, markerSize, markerSize)
      }

      // Link lines — only meaningful in left→right mode with a real cut path.
      // The cut path runs from its left endpoint (cutPath[0], u<0) over the top
      // to its right endpoint (cutPath[last], u>0); both at v = BO.
      if (cutMode !== CUT_MODE_LEFT_ONLY && cutPath.length >= 2) {
        const startPt = cutPath[0]                 // left BO crossing
        const endPt = cutPath[cutPath.length - 1]  // right BO crossing
        const y = Y(markerV)
        ctx.lineWidth = 1.5
        ctx.setLineDash([])
        if (isOdd) {
          // green: left marker → path start (left); red: path end (right) → right marker
          ctx.strokeStyle = GREEN
          ctx.beginPath()
          ctx.moveTo(X(leftMarkerU), y)
          ctx.lineTo(X(startPt.u), y)
          ctx.stroke()
          ctx.strokeStyle = RED
          ctx.beginPath()
          ctx.moveTo(X(endPt.u), y)
          ctx.lineTo(X(rightMarkerU), y)
          ctx.stroke()
        } else {
          // green: right marker → path end (right); red: path start (left) → left marker
          ctx.strokeStyle = GREEN
          ctx.beginPath()
          ctx.moveTo(X(endPt.u), y)
          ctx.lineTo(X(rightMarkerU), y)
          ctx.stroke()
          ctx.strokeStyle = RED
          ctx.beginPath()
          ctx.moveTo(X(leftMarkerU), y)
          ctx.lineTo(X(startPt.u), y)
          ctx.stroke()
        }
      }

      drawMarker(leftMarkerU, leftColor, leftDark)
      drawMarker(rightMarkerU, rightColor, rightDark)
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)

    return () => ro.disconnect()
  }, [contour, cutPath, stock, cutIndex, cutMode, thetaDeg, zoom, pan])

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

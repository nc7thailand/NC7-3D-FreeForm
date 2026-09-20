import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { CUT_MODE_LEFT_ONLY, effectiveCutCount } from '../lib/cutJob'
import WireSimulatorBar from './WireSimulatorBar'
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
// Sim playback speed comes from the simulator's own feed rate (Model A):
// baseSpeed = simFeedRate / 60 mm/s, scaled by the speed multiplier. Both live
// in `simSettings` (AppState + localStorage), so there is no module constant.
// Data-log sampling interval during playback (10 Hz).
const SIM_SAMPLE_MS = 100
// Trail stroke.
const TRAIL_COLOR = 'rgba(255, 69, 0, 0.35)'
const TRAIL_WIDTH = 1.5
// Matches cutOverlay.js's MARKER_SIZE so the Sim dot is the same size as the
// green/red direction markers.
const MARKER_SIZE = 7

/**
 * Cumulative arc length at each vertex of a polyline, in mm.
 * `cum[0]` is 0 and `cum[last]` is the total travel length.
 *
 * @param {{u:number,v:number}[]} pts
 * @returns {number[]}
 */
function cumulativeLengths(pts) {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].u - pts[i - 1].u, pts[i].v - pts[i - 1].v))
  }
  return cum
}

/**
 * Point at absolute arc length `distance` (mm) along a polyline, with the
 * cumulative-length table supplied by the caller so playback does not rebuild
 * it every frame.
 *
 * Interpolates within the containing segment — it never snaps to a vertex, and
 * it never leaves the polyline, so a sampled position cannot overshoot the
 * travel's extent. `distance` is clamped to [0, total].
 *
 * @param {{u:number,v:number}[]} pts
 * @param {number[]} cum - cumulative lengths, same length as `pts`
 * @param {number} distance - mm along the polyline
 */
function pointAtDistance(pts, cum, distance) {
  if (!pts?.length) return null
  if (pts.length === 1) return { u: pts[0].u, v: pts[0].v }
  const total = cum[cum.length - 1]
  // Bail out rather than returning a vertex: a non-finite total means the
  // polyline itself is poisoned, and handing back coordinates here is what fed
  // NaN into createRadialGradient.
  if (!isFinite(total) || !(total > 0)) return null
  if (!isFinite(distance)) return null

  const d = Math.min(total, Math.max(0, distance))
  // Advance while the next vertex is nearer than our target. Linear from the
  // end: the tables are a few hundred entries, so a scan is cheaper than a
  // binary search at 60 fps.
  let i = 0
  while (i < cum.length - 2 && cum[i + 1] < d) i++
  const segLen = cum[i + 1] - cum[i]
  if (!(segLen > 0)) return { u: pts[i].u, v: pts[i].v }
  const t = (d - cum[i]) / segLen
  return {
    u: pts[i].u + t * (pts[i + 1].u - pts[i].u),
    v: pts[i].v + t * (pts[i + 1].v - pts[i].v),
  }
}

/**
 * The wire's full travel for one rotation, as one MONOTONE polyline:
 * green marker → cut path → red marker.
 *
 * The marker squares come straight from `markers` (coloured by parity), and the
 * cut path is oriented so its first point is the end nearer the green marker.
 * Assembling it from the link endpoints instead produced an out-and-back
 * excursion: one link endpoint always lies exactly ON a cut-path end, so
 * walking `[link.from, link.to, ...cut]` visited the far marker and returned.
 *
 * @param {{u:number,v:number}[]} cutPath
 * @param {{u:number,v:number,color:string}[]} markers
 * @param {{green:string, red:string}} colors
 */
function buildFullWirePath(cutPath, markers, colors) {
  if (!cutPath?.length) return []
  const greenMarker = markers?.find((m) => m.color === colors.green)
  const redMarker = markers?.find((m) => m.color === colors.red)
  // Guard on the *coordinates*, not just on the find(): a wrong-shaped argument
  // (e.g. the link objects, which carry a color but no u/v) matches by colour
  // and then yields undefined coordinates, which poisons every downstream
  // position with NaN instead of failing loudly.
  if (!isFinite(greenMarker?.u) || !isFinite(greenMarker?.v)
    || !isFinite(redMarker?.u) || !isFinite(redMarker?.v)) {
    console.warn(
      '[sim] wire-path marker lookup failed — expected marker squares with '
      + `finite u/v for ${colors.green} and ${colors.red}. Got: `
      + JSON.stringify(greenMarker) + ' / ' + JSON.stringify(redMarker),
    )
    return cutPath
  }

  const last = cutPath[cutPath.length - 1]
  const distStart = Math.hypot(cutPath[0].u - greenMarker.u, cutPath[0].v - greenMarker.v)
  const distEnd = Math.hypot(last.u - greenMarker.u, last.v - greenMarker.v)
  const cut = distStart <= distEnd ? cutPath : [...cutPath].reverse()

  const full = [
    { u: greenMarker.u, v: greenMarker.v },
    ...cut,
    { u: redMarker.u, v: redMarker.v },
  ]

  // Drop consecutive duplicates — zero-length segments would make the
  // arc-length sampler divide by zero and stall the animation.
  return full.filter((p, i) => i === 0 || Math.hypot(
    p.u - full[i - 1].u, p.v - full[i - 1].v,
  ) > 1e-6)
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
  setSimPlaying,
  rotationN,
  simSettings,
  updateSimSettings,
  onOpenSimPanel,
  onStopSim,
}) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)

  // Simulator playback preferences (feed rate + speed multiplier). Owned by
  // AppState so the WSB and this loop cannot drift apart; persisted to
  // localStorage, never to the project manifest or gcodeSettings.
  const simFeedRate = simSettings?.simFeedRate ?? 500
  const speedMultiplier = simSettings?.simSpeedMultiplier ?? 10
  // Model A: the base rate IS the machine feed rate, so the time readout is
  // real job time. Visual speed = base × multiplier.
  const baseSpeedMMPerSec = simFeedRate / 60

  // Zoom/pan transform state. Pan is in screen pixels; zoom is a linear scale.
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef(null) // { x, y, pointerId }
  const pinchRef = useRef(null) // { startDist, startZoom, cx, cy }
  // Sim playback distance along the travel, in mm. Held in a ref (not state)
  // so the animation loop can drive the canvas without re-rendering React on
  // every frame; `simDrawRef` lets the loop call the current draw closure.
  const simDistRef = useRef(0)
  // Playback speed multiplier. Position is integrated (`+= dt × base × speed`),
  // so changing this mid-play alters the rate from that frame forward without
  // moving the marker — an absolute-time model could not do that without a jump.
  // Mirrors `speedMultiplier` from AppState so the animation loop reads it
  // without re-subscribing (and without a new render per slider tick).
  const simSpeedRef = useRef(speedMultiplier)
  simSpeedRef.current = speedMultiplier
  const simDrawRef = useRef(() => {})
  const simRafRef = useRef(null)
  // Sim trail (points the marker has passed through) and the 10 Hz data log.
  // The trail is a ref because the draw loop repaints from it every frame; the
  // live label needs React state so the DOM text updates.
  const simTrailRef = useRef([])
  const simLogRef = useRef([])
  const simLastSampleRef = useRef(-Infinity)
  const [simLabel, setSimLabel] = useState(null)
  const [simLogOpen, setSimLogOpen] = useState(false)
  const [simLogTick, setSimLogTick] = useState(0)
  const [simCopied, setSimCopied] = useState(false)
  // Published to the WSB at 10 Hz (see publishDistance). Distinct from
  // simDistRef, which is the per-frame source of truth for the canvas.
  const [simDistance, setSimDistance] = useState(0)

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
    () => buildFullWirePath(cutPath, annotations.markers, OVERLAY_COLORS),
    [cutPath, annotations.markers],
  )

  // Cumulative arc length per vertex, in mm. Playback samples by distance, so
  // this is the only thing that defines position along the travel — there are
  // no index-based fractions left to disagree with it. Rebuilt only when the
  // path changes, never per frame.
  const wireCum = useMemo(() => cumulativeLengths(fullWirePath), [fullWirePath])
  const wireLengthMM = wireCum.length ? wireCum[wireCum.length - 1] : 0

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

      // Experimental Sim — trail of the ground the marker has already covered.
      // Drawn above the overlay drawing but below the marker itself.
      if (simActive && simTrailRef.current.length >= 2) {
        ctx.strokeStyle = TRAIL_COLOR
        ctx.lineWidth = TRAIL_WIDTH
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(X(simTrailRef.current[0].u), Y(simTrailRef.current[0].v))
        for (let i = 1; i < simTrailRef.current.length; i++) {
          ctx.lineTo(X(simTrailRef.current[i].u), Y(simTrailRef.current[i].v))
        }
        ctx.stroke()
      }

      // Experimental Sim — the hot wire tip travelling the current rotation's
      // full travel: green safe point → lead-in → cut path → lead-out → red
      // safe point, as one continuous motion. Screen-space radii (does not
      // scale with zoom). The blink is driven off wall-clock time so it stays
      // steady regardless of frame rate.
      if (simActive && fullWirePath.length >= 2) {
        const wirePt = pointAtDistance(fullWirePath, wireCum, simDistRef.current)
        if (wirePt) {
          const wx = X(wirePt.u)
          const wy = Y(wirePt.v)
          // Never hand the canvas a non-finite coordinate: createRadialGradient
          // throws outright, which would take the whole draw loop down.
          if (isFinite(wx) && isFinite(wy)) {
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
    }

    simDrawRef.current = draw
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)

    return () => ro.disconnect()
  }, [contour, cutPath, fullWirePath, annotations, stock, cutIndex, cutMode, thetaDeg, zoom, pan, simDot, simActive])

  // Sim playback: advance the wire along the travel at a constant feedrate
  // (SIM_SPEED_MM_PER_SEC × simSpeedRef), accumulating a trail and logging a
  // data row every SIM_SAMPLE_MS. Distance is INTEGRATED frame to frame, not
  // derived from absolute elapsed time:
  //   - changing speed mid-play alters the rate without moving the marker
  //   - pausing and resuming continues from where it stopped, instead of
  //     restarting from 0 (an absolute `elapsed × speed` model could not, since
  //     `start` is re-created every time this effect re-runs)
  // Only this loop repaints; the rest of the panel redraws on state change.
  useEffect(() => {
    if (!simPlaying || fullWirePath.length < 2 || !(wireLengthMM > 0)) return undefined
    let lastFrameAt = null
    let lastLabelAt = -Infinity
    // Restart only when there is genuinely nothing to resume: at the end of the
    // travel, or before the first frame ever ran.
    if (!(simDistRef.current > 0) || simDistRef.current >= wireLengthMM) {
      simDistRef.current = 0
      simTrailRef.current = []
      simLogRef.current = []
      simLastSampleRef.current = -Infinity
    }
    const step = (now) => {
      // First frame after a start/resume: no elapsed time to integrate yet.
      if (lastFrameAt == null) lastFrameAt = now
      const dt = Math.max(0, (now - lastFrameAt) / 1000)
      lastFrameAt = now

      const distance = Math.min(
        simDistRef.current + dt * baseSpeedMMPerSec * simSpeedRef.current,
        wireLengthMM,
      )
      simDistRef.current = distance

      const pt = pointAtDistance(fullWirePath, wireCum, distance)
      if (pt) {
        const trail = simTrailRef.current
        const tail = trail[trail.length - 1]
        if (!tail || Math.hypot(pt.u - tail.u, pt.v - tail.v) > 1e-6) {
          trail.push({ u: pt.u, v: pt.v })
        }
      }

      // 10 Hz data log, independent of frame rate.
      if (now - simLastSampleRef.current >= SIM_SAMPLE_MS && pt) {
        simLastSampleRef.current = now
        simLogRef.current.push({
          n: (cutIndex ?? 0) + 1,
          u: +pt.u.toFixed(2),
          v: +pt.v.toFixed(2),
          distance: +distance.toFixed(1),
        })
        setSimLogTick(simLogRef.current.length)
      }

      const label = {
        n: (cutIndex ?? 0) + 1,
        u: pt?.u ?? 0,
        v: pt?.v ?? 0,
        distance,
      }
      // Re-render for the label at 10 Hz, not every frame.
      if (now - lastLabelAt >= SIM_SAMPLE_MS) {
        lastLabelAt = now
        setSimLabel(label)
        setSimDistance(distance)
      }

      simDrawRef.current()
      if (distance >= wireLengthMM) {
        simRafRef.current = null
        setSimLabel(label)
      } else {
        simRafRef.current = requestAnimationFrame(step)
      }
    }
    simRafRef.current = requestAnimationFrame(step)
    return () => {
      if (simRafRef.current) cancelAnimationFrame(simRafRef.current)
      simRafRef.current = null
    }
  }, [simPlaying, fullWirePath, wireCum, wireLengthMM, cutIndex, baseSpeedMMPerSec])

  useEffect(() => {
    // Park the marker at the travel's start (green.from) whenever the path
    // changes. Reset before the repaint so no frame can show the new path with
    // the previous cut's distance still in the ref.
    simDistRef.current = 0
    simTrailRef.current = []
    simLogRef.current = []
    simLastSampleRef.current = -Infinity
    setSimLabel(null)
    setSimLogTick(0)
    setSimDistance(0)
    simDrawRef.current()
  }, [fullWirePath, wireCum, cutIndex, simActive])

  /**
   * Scrub to an absolute distance (mm) along the travel. Stops playback — a
   * seek during play would fight the integrator — and re-derives the trail by
   * slicing the path up to the seek index, so the drawn trail always
   * corresponds to the new position instead of accumulating across the jump.
   */
  const seekTo = useCallback((distance) => {
    const total = wireLengthMM
    if (!(total > 0)) return
    const d = Math.min(total, Math.max(0, distance))
    setSimPlaying(false)
    simDistRef.current = d

    // Trail = the path up to the containing vertex, plus the interpolated
    // point, so it matches the polyline rather than chording across it.
    let i = 0
    while (i < wireCum.length - 2 && wireCum[i + 1] < d) i++
    const head = fullWirePath.slice(0, i + 1)
    const pt = pointAtDistance(fullWirePath, wireCum, d)
    simTrailRef.current = pt ? [...head, { u: pt.u, v: pt.v }] : head

    // The log is a monotonic event trace of a run; a seek invalidates it.
    simLogRef.current = []
    simLastSampleRef.current = -Infinity
    setSimLogTick(0)
    setSimDistance(d)
    simDrawRef.current()
  }, [fullWirePath, wireCum, wireLengthMM, setSimPlaying])

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

    // The pan handlers are attached to `wrap`, and the wire simulator bar is
    // rendered INSIDE it. Without this guard a press on a WSB control bubbles
    // here, and `setPointerCapture` retargets the gesture to `wrap` — which
    // both pan the canvas and swallow the control's own click. Ignore anything
    // originating in the bar; the controls keep their normal behaviour.
    const isFromOverlayControl = (e) => !!e.target?.closest?.('.wsb-bar')

    const onWheel = (e) => {
      if (isFromOverlayControl(e)) return
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.0015)
      zoomAt(e.clientX, e.clientY, factor)
    }

    const onPointerDown = (e) => {
      if (isFromOverlayControl(e)) return
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
      if (isFromOverlayControl(e)) return
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

    const onDoubleClick = (e) => {
      if (isFromOverlayControl(e)) return
      resetView()
    }

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

  // --- WSB-facing derived values -------------------------------------------
  // Status names the run, not the motion: CUTTING means the playhead is
  // advancing, DONE means it reached the end.
  const simStatus = useMemo(() => {
    if (wireLengthMM <= 0) return 'READY'
    if (simDistance >= wireLengthMM) return 'DONE'
    if (simPlaying) return 'CUTTING'
    return simDistance > 0 ? 'PAUSED' : 'READY'
  }, [simDistance, wireLengthMM, simPlaying])

  // Real machine time, deliberately WITHOUT the speed multiplier: the readout
  // answers "how far into the actual job are we", which is the point of tying
  // the base rate to the feed rate. Faster playback does not shorten the job.
  const mmss = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
    const total = Math.round(seconds)
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  const simTimeElapsed = mmss(baseSpeedMMPerSec > 0 ? simDistance / baseSpeedMMPerSec : 0)
  const simTimeTotal = mmss(baseSpeedMMPerSec > 0 ? wireLengthMM / baseSpeedMMPerSec : 0)
  const simPct = wireLengthMM > 0 ? `${((simDistance / wireLengthMM) * 100).toFixed(1)}%` : '0.0%'

  // --- WSB handlers ---------------------------------------------------------
  // Stop leaves Sim mode entirely, so the bar unmounts and distance resets.
  const handleSimStop = useCallback(() => {
    setSimPlaying(false)
    simDistRef.current = 0
    simTrailRef.current = []
    simLogRef.current = []
    simLastSampleRef.current = -Infinity
    setSimDistance(0)
    setSimLabel(null)
    setSimLogTick(0)
    onStopSim?.()
  }, [onStopSim, setSimPlaying])

  // Reset rewinds the current run but stays in Sim mode.
  const handleSimReset = useCallback(() => {
    setSimPlaying(false)
    simDistRef.current = 0
    simTrailRef.current = []
    simLogRef.current = []
    simLastSampleRef.current = -Infinity
    setSimDistance(0)
    setSimLabel(null)
    setSimLogTick(0)
    simDrawRef.current()
  }, [setSimPlaying])

  // Speed persists immediately — it is a playback preference, not a committed
  // edit, so there is deliberately no Apply gate on the slider.
  const handleSpeedChange = useCallback((mult) => {
    updateSimSettings?.({ simSpeedMultiplier: Math.min(100, Math.max(1, Math.round(mult))) })
  }, [updateSimSettings])

  const handleScrub = useCallback((value) => {
    seekTo((value / 1000) * wireLengthMM)
  }, [seekTo, wireLengthMM])

  const handleCopyLog = useCallback(async () => {
    const rows = simLogRef.current
    const csv = [
      'N,u,v,distance_mm',
      ...rows.map((r) => `${r.n},${r.u.toFixed(2)},${r.v.toFixed(2)},${r.distance?.toFixed(1) ?? ''}`),
    ].join('\n')
    try {
      await navigator.clipboard.writeText(csv)
      setSimCopied(true)
      setTimeout(() => setSimCopied(false), 500)
    } catch {
      /* clipboard may be unavailable */
    }
  }, [])

  return (
    <section className="silhouette-preview-section">
      <div className="section-label section-label-sub">2D Silhouette Preview (Stage 1)</div>

      <div className="preview-wrap silhouette-preview-canvas-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} />
        {simActive && simLabel && (
          <button
            type="button"
            className="sim-data-label"
            onClick={() => setSimLogOpen(true)}
            title="Open Sim track log"
          >
            {`N=${simLabel.n}  u=${simLabel.u.toFixed(1)}  v=${simLabel.v.toFixed(1)}  `
              + `${(simLabel.distance ?? 0).toFixed(0)}mm`}
          </button>
        )}
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

      {/* Wire simulator bar — only while Sim mode is on.
          Deliberately a SIBLING of the canvas wrap, not a child: the wrap sets
          `overflow: hidden`, which would clip the bar, and it is also the
          element the pan/zoom pointer handlers are bound to, so nesting the
          controls there made presses pan the canvas. */}
      {simActive && (
        <WireSimulatorBar
          status={simStatus}
          playing={simPlaying}
          distanceMM={simDistance}
          lengthMM={wireLengthMM}
          pct={simPct}
          elapsedLabel={simTimeElapsed}
          totalLabel={simTimeTotal}
          speedMultiplier={speedMultiplier}
          onGear={onOpenSimPanel}
          onStop={handleSimStop}
          onTogglePlay={() => setSimPlaying((v) => !v)}
          onReset={handleSimReset}
          onSpeedChange={handleSpeedChange}
          onScrub={handleScrub}
        />
      )}

      <div className="silhouette-preview-footer">
        {contour.length > 0 ? `${contour.length} pts · bins ${GRID_BINS} · ${(zoom * 100).toFixed(0)}%` : '—'}
      </div>

      {simLogOpen && (
        <div className="sim-log-backdrop" role="dialog" aria-label="Sim track log">
          <div className="sim-log-panel">
            <div className="sim-log-header">
              <span className="sim-log-title">
                Sim Track Log
                <span className="sim-log-count">{` · ${simLogTick} rows`}</span>
              </span>
              <button
                type="button"
                className="sim-log-close"
                onClick={() => setSimLogOpen(false)}
                aria-label="Close log"
              >
                ×
              </button>
            </div>
            <div className="sim-log-body">
              <table className="sim-log-table">
                <thead>
                  <tr>
                    <th>N</th><th>u</th><th>v</th><th>mm</th>
                  </tr>
                </thead>
                <tbody>
                  {simLogRef.current.map((r, i) => (
                    <tr key={i}>
                      <td>{r.n}</td>
                      <td>{r.u.toFixed(2)}</td>
                      <td>{r.v.toFixed(2)}</td>
                      <td>{r.distance?.toFixed(1) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="sim-log-footer">
              <button type="button" className="sim-log-export" onClick={handleCopyLog}>
                {simCopied ? 'Copied' : 'Copy CSV'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

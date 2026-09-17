import React, { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { extractFullSilhouette } from '../lib/silhouette'
import { cuttingPlane, planePointMiddleFromStock } from '../lib/toolpath'
import { CUT_MODE_LEFT_TO_RIGHT, CUT_MODE_LEFT_ONLY } from '../lib/cutJob'

// Quality is fixed at High (600 grid bins) for the Stage 1 preview.
const GRID_BINS = 600

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
 * In left-only mode the path stops at the silhouette's topmost crossing of the
 * rotation axis (u = 0) instead of continuing down the right side.
 *
 * @param {{u:number,v:number}[]} contour - closed loop
 * @param {number} boV - BO level (v = BO)
 * @param {boolean} leftOnly - stop at the topmost u = 0 crossing
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

  // Left-only: stop where the path meets the rotation axis (u = 0). Take the
  // highest such crossing on the arc — the path can dip through the axis more
  // than once (e.g. under a concave neck), and the cut ends at the top of the
  // left half, not at the first touch.
  let cutIdx = -1
  let cutV = -Infinity
  let apex = null
  for (let i = 1; i < best.arc.length; i++) {
    const p = crossAt(best.arc[i - 1], best.arc[i], 'u', 0)
    if (p && p.v > cutV) {
      cutV = p.v
      cutIdx = i
      apex = p
    }
  }
  if (cutIdx < 0) return best.arc
  return [...best.arc.slice(0, cutIdx), apex]
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
  cutMode,
  setCutMode,
  stock,
}) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)

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

      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
      for (const p of contour) {
        if (p.u < minU) minU = p.u
        if (p.u > maxU) maxU = p.u
        if (p.v < minV) minV = p.v
        if (p.v > maxV) maxV = p.v
      }
      const spanU = Math.max(maxU - minU, 1e-6)
      const spanV = Math.max(maxV - minV, 1e-6)
      const pad = Math.min(w, h) * 0.1
      const scale = Math.min((w - pad * 2) / spanU, (h - pad * 2) / spanV)
      const X = (u) => (u - minU) * scale + (w - spanU * scale) / 2
      const Y = (v) => h - pad - (v - minV) * scale

      // Reference axes — world origin guides, drawn behind the silhouette.
      // Red vertical line at u = 0 (rotation axis); blue horizontal line at
      // v = BO (bottom cutout offset) — the level where the wire stops cutting
      // so the workpiece stays attached to the block below it. Both are thin
      // dashed lines spanning the full canvas so they never compete with the
      // silhouette.
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

      // Silhouette outline — dashed, 50% opacity so it reads lighter than the
      // reference axes while staying traceable at every rotation.
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

      // Cut path — the stretch of silhouette the wire actually follows. Solid
      // brighter blue so it reads clearly against the dashed BO line, drawn on
      // top of the reference outline.
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
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [contour, cutPath, stock?.bo])

  return (
    <section className="silhouette-preview-section">
      <div className="section-label section-label-sub">2D Silhouette Preview (Stage 1)</div>

      <div className="silhouette-preview-controls">
        <div className="silhouette-mode-toggle">
          <button
            type="button"
            className={`silhouette-mode-btn${cutMode === CUT_MODE_LEFT_TO_RIGHT ? ' is-active' : ''}`}
            onClick={() => setCutMode(CUT_MODE_LEFT_TO_RIGHT)}
          >
            Left → Right
          </button>
          <button
            type="button"
            className={`silhouette-mode-btn${cutMode === CUT_MODE_LEFT_ONLY ? ' is-active' : ''}`}
            onClick={() => setCutMode(CUT_MODE_LEFT_ONLY)}
          >
            Left only
          </button>
        </div>
      </div>

      <div className="preview-wrap silhouette-preview-canvas-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} />
      </div>

      <div className="silhouette-preview-footer">
        {contour.length > 0 ? `${contour.length} pts · bins ${GRID_BINS}` : '—'}
      </div>
    </section>
  )
}

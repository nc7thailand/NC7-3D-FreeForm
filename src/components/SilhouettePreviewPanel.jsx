import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { extractFullSilhouette } from '../lib/silhouette'
import { cuttingPlane, planePointMiddleFromStock } from '../lib/toolpath'
import { CUT_MODE_LEFT_TO_RIGHT, CUT_MODE_LEFT_ONLY } from '../lib/cutJob'

// Quality presets -> explicit marching-squares grid bins (v bins). The u grid
// is derived from these (uBins = vBins * 1.25) inside shadowGridSpec.
const QUALITY_BINS = { low: 150, medium: 300, high: 600 }
const DEFAULT_QUALITY = 'medium'

/**
 * Ramer–Douglas–Peucker polyline simplification (pure math; ON/OFF toggle).
 */
function rdpSimplify(points, epsilon) {
  if (points.length < 3) return points
  const closed = Math.hypot(
    points[0].u - points[points.length - 1].u,
    points[0].v - points[points.length - 1].v,
  ) < 1e-9
  const ring = closed ? points.slice(0, -1) : points.slice()
  if (ring.length < 3) return points

  const keep = new Uint8Array(ring.length)
  const stack = [[0, ring.length - 1]]
  const segDist = (i, a, b) => {
    const p = ring[i]
    const abx = b.u - a.u
    const aby = b.v - a.v
    const len2 = abx * abx + aby * aby
    if (len2 < 1e-12) return Math.hypot(p.u - a.u, p.v - a.v)
    const t = Math.max(0, Math.min(1, ((p.u - a.u) * abx + (p.v - a.v) * aby) / len2))
    return Math.hypot(p.u - (a.u + t * abx), p.v - (a.v + t * aby))
  }
  keep[0] = 1
  keep[ring.length - 1] = 1
  while (stack.length) {
    const [s, e] = stack.pop()
    if (e <= s + 1) continue
    let maxD = -1
    let maxI = -1
    for (let i = s + 1; i < e; i++) {
      const d = segDist(i, ring[s], ring[e])
      if (d > maxD) { maxD = d; maxI = i }
    }
    if (maxD > epsilon) {
      keep[maxI] = 1
      stack.push([s, maxI], [maxI, e])
    }
  }

  const out = []
  for (let i = 0; i < ring.length; i++) if (keep[i]) out.push(ring[i])
  if (closed && out.length > 0) out.push(out[0])
  return out
}

/**
 * Stage 1 two-dimensional silhouette preview — DevFoam-style, synced to the
 * app's shared rotation state.
 *
 * Renders the raw closed shadow loop for the CURRENT rotation step (thetaDeg)
 * as a black polyline on a light background. Coordinate system: Y up, origin
 * bottom-left. No block boundary, no frame, no clamp, no safe points.
 *
 * The panel is driven by the same cutIndex/cutCount/thetaDeg as the 3D view,
 * so the < / > rotation controls keep both views in lock-step.
 */
export default function SilhouettePreviewPanel({
  geometry,
  stock,
  thetaDeg,
  cutIndex,
  cutCount,
  rotationN,
  cutMode,
  setCutMode,
  setCutIndex,
}) {
  const [quality, setQuality] = useState(DEFAULT_QUALITY)
  const [rdp, setRdp] = useState(false)
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)

  const gridBins = QUALITY_BINS[quality] ?? QUALITY_BINS.medium

  const contour = useMemo(() => {
    if (!geometry) return []
    try {
      const frame = cuttingPlane(thetaDeg, planePointMiddleFromStock())
      return extractFullSilhouette(geometry, frame, { profileAccuracy: 5, gridBins })
    } catch (err) {
      console.warn('silhouette preview failed:', err)
      return []
    }
  }, [geometry, thetaDeg, gridBins])

  const display = useMemo(() => {
    if (!contour.length) return []
    return rdp ? rdpSimplify(contour, 0.05) : contour
  }, [contour, rdp])

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

      if (!display.length) {
        ctx.fillStyle = '#8892a0'
        ctx.font = '13px system-ui'
        ctx.textAlign = 'center'
        ctx.fillText('No silhouette at this angle', w / 2, h / 2)
        return
      }

      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
      for (const p of display) {
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

      ctx.strokeStyle = '#1a1d22'
      ctx.lineWidth = 1.6
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(X(display[0].u), Y(display[0].v))
      for (let i = 1; i < display.length; i++) ctx.lineTo(X(display[i].u), Y(display[i].v))
      ctx.closePath()
      ctx.stroke()
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [display])

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

        <div className="silhouette-step-nav">
          <button
            type="button"
            className="cut-nav-btn"
            disabled={cutIndex <= 0}
            onClick={() => setCutIndex((i) => Math.max(0, i - 1))}
            aria-label="Previous step"
          >
            ◀
          </button>
          <span className="silhouette-step-readout">
            {cutIndex + 1} / {cutCount}
          </span>
          <button
            type="button"
            className="cut-nav-btn"
            disabled={cutIndex >= cutCount - 1}
            onClick={() => setCutIndex((i) => Math.min(cutCount - 1, i + 1))}
            aria-label="Next step"
          >
            ▶
          </button>
          <span className="silhouette-step-deg">{thetaDeg.toFixed(1)}°</span>
        </div>

        <p className="silhouette-step-hint">
          {rotationN} rotations → {cutCount} cuts
          {cutMode === CUT_MODE_LEFT_TO_RIGHT ? ' (left + right paired)' : ' (left only)'}
        </p>

        <div className="silhouette-quality">
          <span className="silhouette-quality-label">
            Quality: {quality.charAt(0).toUpperCase() + quality.slice(1)}
          </span>
          <input
            type="range"
            min="0"
            max="2"
            step="1"
            value={quality === 'low' ? 0 : quality === 'medium' ? 1 : 2}
            onChange={(e) => {
              const idx = Number(e.target.value)
              setQuality(idx === 0 ? 'low' : idx === 1 ? 'medium' : 'high')
            }}
          />
          <span className="silhouette-quality-marks">Low · Med · High</span>
        </div>

        <label className="silhouette-rdp-toggle">
          <input
            type="checkbox"
            checked={rdp}
            onChange={(e) => setRdp(e.target.checked)}
          />
          <span>RDP simplify</span>
        </label>
      </div>

      <div className="preview-wrap silhouette-preview-canvas-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} />
      </div>

      <div className="silhouette-preview-footer">
        {display.length > 0 ? `${display.length} pts · bins ${gridBins}` : '—'}
      </div>
    </section>
  )
}

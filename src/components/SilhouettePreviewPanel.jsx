import React, { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { extractFullSilhouette } from '../lib/silhouette'
import { cuttingPlane, planePointMiddleFromStock } from '../lib/toolpath'
import { CUT_MODE_LEFT_TO_RIGHT, CUT_MODE_LEFT_ONLY } from '../lib/cutJob'

// Quality is fixed at High (600 grid bins) for the Stage 1 preview.
const GRID_BINS = 600

/**
 * Stage 1 two-dimensional silhouette preview — DevFoam-style, synced to the
 * app's shared rotation state.
 *
 * Renders the raw closed shadow loop for the CURRENT rotation step (thetaDeg)
 * as a black polyline on a light background. Coordinate system: Y up, origin
 * bottom-left. No block boundary, no frame, no clamp, no safe points.
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

      ctx.strokeStyle = '#1a1d22'
      ctx.lineWidth = 1.6
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(X(contour[0].u), Y(contour[0].v))
      for (let i = 1; i < contour.length; i++) ctx.lineTo(X(contour[i].u), Y(contour[i].v))
      ctx.closePath()
      ctx.stroke()
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [contour])

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

import React, { useEffect, useMemo, useRef } from 'react'
import { buildMinimapTopDownData, drawMinimap2D, MINIMAP_SIZE_PX } from '../lib/minimap2d.js'

/**
 * Compact circular minimap — true top-down model silhouette with N-cut dots
 * (red = inactive, blue = active cut). No path lines.
 */
export default function Minimap2DOverlay({
  stock,
  geometry,
  rotationN,
  cutMode,
  cutIndex,
}) {
  const canvasRef = useRef(null)

  const scene = useMemo(
    () => buildMinimapTopDownData({
      stock,
      geometry,
      rotationN,
      cutMode,
      cutIndex,
    }),
    [stock, geometry, rotationN, cutMode, cutIndex],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const size = MINIMAP_SIZE_PX
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`

    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawMinimap2D(ctx, size, scene)
  }, [scene])

  return (
    <div className="minimap-2d-overlay" aria-hidden="true">
      <canvas ref={canvasRef} className="minimap-2d-canvas" />
    </div>
  )
}

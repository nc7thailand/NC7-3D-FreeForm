// Compact circular top-down minimap for the Toolpath 2D canvas.
//
// Orthographic −Y view: world X → screen right, world Z → screen up.
// Model outline via coarse XZ grid + marching squares; cut dots at each θ.

import { cutAnglesForN } from './cutJob.js'
import { traceGridBoundary } from './gridContour.js'

export const MINIMAP_SIZE_PX = 88
const PADDING_PX = 10
const TOP_DOWN_GRID_BINS = 40

const CUT_DOT_RADIUS = 3
const ACTIVE_CUT_COLOR = '#1d5cff'
const INACTIVE_CUT_COLOR = '#ef4444'

function extendBounds(bounds, x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return bounds
  if (!bounds) return { minX: x, maxX: x, minZ: z, maxZ: z }
  if (x < bounds.minX) bounds.minX = x
  if (x > bounds.maxX) bounds.maxX = x
  if (z < bounds.minZ) bounds.minZ = z
  if (z > bounds.maxZ) bounds.maxZ = z
  return bounds
}

function pointInTriXZ(px, pz, ax, az, bx, bz, cx, cz) {
  const d1 = (px - bx) * (az - bz) - (ax - bx) * (pz - bz)
  const d2 = (px - cx) * (bz - cz) - (bx - cx) * (pz - cz)
  const d3 = (px - ax) * (cz - az) - (cx - ax) * (pz - az)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

function markTriangleXZ(grid, spec, ax, az, bx, bz, cx, cz) {
  const { uMin, vMin, uStep, vStep, uBins, vBins } = spec
  const minX = Math.min(ax, bx, cx)
  const maxX = Math.max(ax, bx, cx)
  const minZ = Math.min(az, bz, cz)
  const maxZ = Math.max(az, bz, cz)
  const i0 = Math.max(0, Math.floor((minX - uMin) / uStep))
  const i1 = Math.min(uBins - 1, Math.floor((maxX - uMin) / uStep))
  const j0 = Math.max(0, Math.floor((minZ - vMin) / vStep))
  const j1 = Math.min(vBins - 1, Math.floor((maxZ - vMin) / vStep))
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const x = uMin + (i + 0.5) * uStep
      const z = vMin + (j + 0.5) * vStep
      if (pointInTriXZ(x, z, ax, az, bx, bz, cx, cz)) {
        grid[j * uBins + i] = 1
      }
    }
  }
}

/**
 * Simplified bird's-eye (XZ) silhouette of the settled mesh.
 * @returns {{ x: number, z: number }[]}
 */
export function extractTopDownOutline(geometry, gridBins = TOP_DOWN_GRID_BINS) {
  const pos = geometry?.attributes?.position
  if (!pos || pos.count < 3) return []

  geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  if (!bb || bb.isEmpty()) return []

  const margin = 1.04
  const padX = ((bb.max.x - bb.min.x) * (margin - 1)) / 2
  const padZ = ((bb.max.z - bb.min.z) * (margin - 1)) / 2
  const minX = bb.min.x - padX
  const maxX = bb.max.x + padX
  const minZ = bb.min.z - padZ
  const maxZ = bb.max.z + padZ
  const spanX = Math.max(maxX - minX, 1e-3)
  const spanZ = Math.max(maxZ - minZ, 1e-3)

  const uBins = gridBins
  const vBins = Math.max(16, Math.round(gridBins * (spanZ / spanX)))
  const spec = {
    uMin: minX,
    vMin: minZ,
    uStep: spanX / uBins,
    vStep: spanZ / vBins,
    uBins,
    vBins,
  }

  const grid = new Uint8Array(uBins * vBins)
  const index = geometry.index
  const triCount = index ? index.count / 3 : pos.count / 3

  for (let t = 0; t < triCount; t++) {
    const ia = index ? index.getX(t * 3) : t * 3
    const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1
    const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2
    markTriangleXZ(
      grid,
      spec,
      pos.getX(ia), pos.getZ(ia),
      pos.getX(ib), pos.getZ(ib),
      pos.getX(ic), pos.getZ(ic),
    )
  }

  const ring = traceGridBoundary(grid, spec)
  return ring.map((p) => ({ x: p.u, z: p.v }))
}

/** Red / blue cut-index dots placed on a ring at each cut's θ. */
export function buildCutPointMarkers({ rotationN, cutMode, cutIndex, stock }) {
  const angles = cutAnglesForN(rotationN ?? 0, { mode: cutMode })
  const w = stock?.w ?? 100
  const t = stock?.t ?? 100
  const ringR = Math.hypot(w, t) * 0.42

  return angles.map((thetaDeg, index) => {
    const rad = (thetaDeg * Math.PI) / 180
    return {
      index,
      thetaDeg,
      x: ringR * Math.sin(rad),
      z: ringR * Math.cos(rad),
      active: index === cutIndex,
    }
  })
}

export function buildMinimapTopDownData({
  stock, geometry, rotationN, cutMode, cutIndex,
}) {
  const modelOutline = geometry ? extractTopDownOutline(geometry) : []
  const cutPoints = buildCutPointMarkers({ rotationN, cutMode, cutIndex, stock })
  return { modelOutline, cutPoints }
}

export function computeMinimapTopDownBounds({ modelOutline, cutPoints }) {
  let bounds = null
  for (const p of modelOutline ?? []) bounds = extendBounds(bounds, p.x, p.z)
  for (const p of cutPoints ?? []) bounds = extendBounds(bounds, p.x, p.z)
  return bounds
}

function buildCenteredTransform(bounds, size, padding = PADDING_PX) {
  const inner = Math.max(size - padding * 2, 1)
  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-3)
  const spanZ = Math.max(bounds.maxZ - bounds.minZ, 1e-3)
  const scale = inner / Math.max(spanX, spanZ)
  const cx = (bounds.minX + bounds.maxX) / 2
  const cz = (bounds.minZ + bounds.maxZ) / 2
  return {
    X: (x) => size / 2 + (x - cx) * scale,
    Y: (z) => size / 2 - (z - cz) * scale,
  }
}

function strokeOutline(ctx, points, X, Y) {
  if (points.length < 3) return
  ctx.beginPath()
  ctx.moveTo(X(points[0].x), Y(points[0].z))
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(X(points[i].x), Y(points[i].z))
  }
  ctx.closePath()
  ctx.stroke()
}

function fillOutline(ctx, points, X, Y) {
  if (points.length < 3) return
  ctx.beginPath()
  ctx.moveTo(X(points[0].x), Y(points[0].z))
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(X(points[i].x), Y(points[i].z))
  }
  ctx.closePath()
  ctx.fill()
}

/**
 * Draw the compact circular minimap (true top-down, N-cut dots, no path lines).
 */
export function drawMinimap2D(ctx, size, scene) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  ctx.clip()

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)

  const bounds = computeMinimapTopDownBounds(scene)
  if (!bounds) {
    ctx.restore()
    return
  }

  const { X, Y } = buildCenteredTransform(bounds, size)
  const { modelOutline, cutPoints } = scene

  if (modelOutline.length >= 3) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.06)'
    fillOutline(ctx, modelOutline, X, Y)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.lineWidth = 1.1
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    strokeOutline(ctx, modelOutline, X, Y)
  }

  for (const pt of cutPoints ?? []) {
    const px = X(pt.x)
    const py = Y(pt.z)
    const r = pt.active ? CUT_DOT_RADIUS + 0.5 : CUT_DOT_RADIUS
    ctx.beginPath()
    ctx.arc(px, py, r, 0, Math.PI * 2)
    ctx.fillStyle = pt.active ? ACTIVE_CUT_COLOR : INACTIVE_CUT_COLOR
    ctx.fill()
    if (pt.active) {
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }

  ctx.restore()

  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 0.5, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)'
  ctx.lineWidth = 1
  ctx.stroke()
}

// Silhouette extraction for rotary hot-wire cutting.
//
// Type A — front-to-rear orthographic projection (rays along −n through the
// mesh). Anchor is the rear cutting plane (Z = −T/2 at θ = 0).
//
// Collimated shadow: filled UV occupancy raster → per-v min/max u (DevFoam-style).
// Envelope bins kept as fallback when the grid is empty.
// Silhouette-edge attempt: src/lib/checkpoints/silhouette-edges-v1.js
// Envelope-only backup: src/lib/checkpoints/silhouette-envelope-v2.js

import * as THREE from 'three'
import { traceGridBoundary } from './gridContour.js'

const BBOX_CORNERS = [
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
]

function projectToSection(p, frame) {
  const dx = p.x - frame.point.x
  const dy = p.y - frame.point.y
  const dz = p.z - frame.point.z
  return {
    u: dx * frame.uAxis.x + dz * frame.uAxis.z,
    v: dy,
  }
}

function dedupePoints(pts, tol = 0.05) {
  if (pts.length < 2) return pts
  const out = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1]
    const p = pts[i]
    if (Math.hypot(p.u - prev.u, p.v - prev.v) >= tol) out.push(p)
  }
  return out
}

export function clampProfileAccuracy(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 5
  return Math.min(10, Math.max(1, Math.round(n)))
}

/** Grid resolution from DevFoam-style Profile accuracy (1–10). */
export function shadowGridSpec(bounds, profileAccuracy, gridBins = null) {
  // Explicit grid-bins override (2D preview resolution control) takes priority
  // over the Profile-accuracy mapping; when omitted, accuracy maps as before.
  const vBins = gridBins != null && gridBins > 0
    ? Math.round(gridBins)
    : Math.round(50 + clampProfileAccuracy(profileAccuracy) * 16)
  const uBins = Math.round(vBins * 1.25)
  const vSpan = Math.max(bounds.vMax - bounds.vMin, 1e-6)
  const uSpan = Math.max(bounds.uMax - bounds.uMin, 1e-6)
  return {
    ...bounds,
    vBins,
    uBins,
    vStep: vSpan / vBins,
    uStep: uSpan / uBins,
  }
}

function sectionBounds(bbox, frame) {
  const { min, max } = bbox
  const xs = [min.x, max.x]
  const ys = [min.y, max.y]
  const zs = [min.z, max.z]
  let i = 0
  for (const x of xs) {
    for (const y of ys) {
      for (const z of zs) {
        BBOX_CORNERS[i].set(x, y, z)
        i += 1
      }
    }
  }

  let uMin = Infinity
  let uMax = -Infinity
  let vMin = Infinity
  let vMax = -Infinity
  for (const c of BBOX_CORNERS) {
    const p = projectToSection(c, frame)
    uMin = Math.min(uMin, p.u)
    uMax = Math.max(uMax, p.u)
    vMin = Math.min(vMin, p.v)
    vMax = Math.max(vMax, p.v)
  }

  const padU = Math.max((uMax - uMin) * 0.02, 0.05)
  const padV = Math.max((vMax - vMin) * 0.01, 0.05)
  return {
    uMin: uMin - padU,
    uMax: uMax + padU,
    vMin: vMin - padV,
    vMax: vMax + padV,
  }
}

function pointInTriUV(u, v, a, b, c) {
  const denom = (b.v - c.v) * (a.u - c.u) + (c.u - b.u) * (a.v - c.v)
  if (Math.abs(denom) < 1e-14) return false
  const w0 = ((b.v - c.v) * (u - c.u) + (c.u - b.u) * (v - c.v)) / denom
  const w1 = ((c.v - a.v) * (u - c.u) + (a.u - c.u) * (v - c.v)) / denom
  const w2 = 1 - w0 - w1
  return w0 >= -1e-9 && w1 >= -1e-9 && w2 >= -1e-9
}

function fillProjectedTriangle(grid, width, spec, a, b, c) {
  const { uMin, vMin, uStep, vStep, uBins, vBins } = spec
  const iu0 = Math.max(0, Math.floor((Math.min(a.u, b.u, c.u) - uMin) / uStep))
  const iu1 = Math.min(uBins - 1, Math.ceil((Math.max(a.u, b.u, c.u) - uMin) / uStep))
  const iv0 = Math.max(0, Math.floor((Math.min(a.v, b.v, c.v) - vMin) / vStep))
  const iv1 = Math.min(vBins - 1, Math.ceil((Math.max(a.v, b.v, c.v) - vMin) / vStep))

  for (let iv = iv0; iv <= iv1; iv++) {
    const v = vMin + (iv + 0.5) * vStep
    const row = iv * width
    for (let iu = iu0; iu <= iu1; iu++) {
      const u = uMin + (iu + 0.5) * uStep
      if (pointInTriUV(u, v, a, b, c)) grid[row + iu] = 1
    }
  }
}

function extentsFromShadowGrid(grid, spec) {
  const { uMin, vMin, uStep, vStep, uBins, vBins } = spec
  const left = []
  const right = []
  let occupied = 0

  for (let iv = 0; iv < vBins; iv++) {
    let minU = Infinity
    let maxU = -Infinity
    const row = iv * uBins
    for (let iu = 0; iu < uBins; iu++) {
      if (!grid[row + iu]) continue
      occupied += 1
      const u = uMin + (iu + 0.5) * uStep
      if (u < minU) minU = u
      if (u > maxU) maxU = u
    }
    const v = vMin + (iv + 0.5) * vStep
    if (minU < Infinity) left.push({ u: minU, v })
    if (maxU > -Infinity) right.push({ u: maxU, v })
  }

  return { left, right, occupied }
}

function projectFrontToRearShadow(geometry, frame, bbox, profileAccuracy) {
  const bounds = sectionBounds(bbox, frame)
  if (bounds.vMax <= bounds.vMin + 1e-6) return { left: [], right: [], occupied: 0 }

  const spec = shadowGridSpec(bounds, profileAccuracy)
  const grid = new Uint8Array(spec.uBins * spec.vBins)

  const pos = geometry.attributes.position?.array
  if (!pos || pos.length < 9) return { left: [], right: [], occupied: 0 }

  const index = geometry.index?.array
  const triCount = index ? index.length / 3 : pos.length / 9
  const v0 = new THREE.Vector3()
  const v1 = new THREE.Vector3()
  const v2 = new THREE.Vector3()

  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index[t * 3] : t * 3
    const i1 = index ? index[t * 3 + 1] : t * 3 + 1
    const i2 = index ? index[t * 3 + 2] : t * 3 + 2
    v0.fromArray(pos, i0 * 3)
    v1.fromArray(pos, i1 * 3)
    v2.fromArray(pos, i2 * 3)
    fillProjectedTriangle(grid, spec.uBins, spec, projectToSection(v0, frame), projectToSection(v1, frame), projectToSection(v2, frame))
  }

  return extentsFromShadowGrid(grid, spec)
}

function stampBinMin(minU, vMin, vStep, u, v) {
  const i = Math.round((v - vMin) / vStep)
  if (i < 0 || i >= minU.length) return
  if (u < minU[i]) minU[i] = u
}

function stampBinMax(maxU, vMin, vStep, u, v) {
  const i = Math.round((v - vMin) / vStep)
  if (i < 0 || i >= maxU.length) return
  if (u > maxU[i]) maxU[i] = u
}

function stampProjectedEdgeMin(minU, vMin, vStep, a, b) {
  stampBinMin(minU, vMin, vStep, a.u, a.v)
  stampBinMin(minU, vMin, vStep, b.u, b.v)
  const dv = b.v - a.v
  if (Math.abs(dv) < 1e-9) return
  const i0 = Math.floor((Math.min(a.v, b.v) - vMin) / vStep)
  const i1 = Math.ceil((Math.max(a.v, b.v) - vMin) / vStep)
  for (let i = Math.max(0, i0); i <= Math.min(minU.length - 1, i1); i++) {
    const v = vMin + i * vStep
    const t = (v - a.v) / dv
    if (t < -1e-6 || t > 1 + 1e-6) continue
    const u = a.u + t * (b.u - a.u)
    if (u < minU[i]) minU[i] = u
  }
}

function stampProjectedEdgeMax(maxU, vMin, vStep, a, b) {
  stampBinMax(maxU, vMin, vStep, a.u, a.v)
  stampBinMax(maxU, vMin, vStep, b.u, b.v)
  const dv = b.v - a.v
  if (Math.abs(dv) < 1e-9) return
  const i0 = Math.floor((Math.min(a.v, b.v) - vMin) / vStep)
  const i1 = Math.ceil((Math.max(a.v, b.v) - vMin) / vStep)
  for (let i = Math.max(0, i0); i <= Math.min(maxU.length - 1, i1); i++) {
    const v = vMin + i * vStep
    const t = (v - a.v) / dv
    if (t < -1e-6 || t > 1 + 1e-6) continue
    const u = a.u + t * (b.u - a.u)
    if (u > maxU[i]) maxU[i] = u
  }
}

/** Envelope fallback — per-v min/max from projected edges (checkpoint v2). */
function projectFrontToRearEnvelope(geometry, frame, bbox, vTol = 0.06) {
  const vMin = bbox.min.y
  const vMax = bbox.max.y
  if (vMax <= vMin + 1e-6) return { left: [], right: [] }

  const vStep = Math.max(vTol, (vMax - vMin) / 600)
  const nBins = Math.max(1, Math.ceil((vMax - vMin) / vStep) + 1)
  const minU = new Float64Array(nBins)
  const maxU = new Float64Array(nBins)
  minU.fill(Infinity)
  maxU.fill(-Infinity)

  const pos = geometry.attributes.position?.array
  if (!pos || pos.length < 9) return { left: [], right: [] }

  const index = geometry.index?.array
  const triCount = index ? index.length / 3 : pos.length / 9
  const v0 = new THREE.Vector3()
  const v1 = new THREE.Vector3()
  const v2 = new THREE.Vector3()

  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index[t * 3] : t * 3
    const i1 = index ? index[t * 3 + 1] : t * 3 + 1
    const i2 = index ? index[t * 3 + 2] : t * 3 + 2
    v0.fromArray(pos, i0 * 3)
    v1.fromArray(pos, i1 * 3)
    v2.fromArray(pos, i2 * 3)
    const a = projectToSection(v0, frame)
    const b = projectToSection(v1, frame)
    const c = projectToSection(v2, frame)
    stampProjectedEdgeMin(minU, vMin, vStep, a, b)
    stampProjectedEdgeMin(minU, vMin, vStep, b, c)
    stampProjectedEdgeMin(minU, vMin, vStep, c, a)
    stampProjectedEdgeMax(maxU, vMin, vStep, a, b)
    stampProjectedEdgeMax(maxU, vMin, vStep, b, c)
    stampProjectedEdgeMax(maxU, vMin, vStep, c, a)
    stampBinMin(minU, vMin, vStep, a.u, a.v)
    stampBinMin(minU, vMin, vStep, b.u, b.v)
    stampBinMin(minU, vMin, vStep, c.u, c.v)
    stampBinMax(maxU, vMin, vStep, a.u, a.v)
    stampBinMax(maxU, vMin, vStep, b.u, b.v)
    stampBinMax(maxU, vMin, vStep, c.u, c.v)
  }

  const left = []
  const right = []
  for (let i = 0; i < nBins; i++) {
    const v = vMin + i * vStep
    if (minU[i] < Infinity) left.push({ u: minU[i], v })
    if (maxU[i] > -Infinity) right.push({ u: maxU[i], v })
  }
  return { left, right }
}

function projectFrontToRearExtents(geometry, frame, bbox, opts = {}) {
  const shadow = projectFrontToRearShadow(geometry, frame, bbox, opts.profileAccuracy ?? 5)
  if (shadow.occupied > 0) {
    return { left: shadow.left, right: shadow.right, source: 'shadow' }
  }
  const envelope = projectFrontToRearEnvelope(geometry, frame, bbox, opts.vTol ?? 0.06)
  return { left: envelope.left, right: envelope.right, source: 'envelope-fallback' }
}

function mergeFullOutline({ left, right }) {
  if (left.length < 2 && right.length < 2) return []
  const leftSorted = [...left].sort((a, b) => a.v - b.v || a.u - b.u)
  const rightSorted = [...right].sort((a, b) => b.v - a.v || a.u - b.u)
  if (leftSorted.length >= 2 && rightSorted.length >= 2) {
    return dedupePoints([...leftSorted, ...rightSorted])
  }
  return dedupePoints(leftSorted.length >= 2 ? leftSorted : rightSorted)
}

// --- True silhouette boundary (contour tracing on the shadow grid) ------------

/**
 * Build the full shadow contour (closed) via grid tracing.
 * Returns empty array when the grid is unoccupied or tracing fails.
 */
function projectShadowContour(geometry, frame, bbox, profileAccuracy, gridBins = null) {
  const bounds = sectionBounds(bbox, frame)
  if (bounds.vMax <= bounds.vMin + 1e-6) return []

  const spec = shadowGridSpec(bounds, profileAccuracy, gridBins)
  const grid = new Uint8Array(spec.uBins * spec.vBins)

  const pos = geometry.attributes.position?.array
  if (!pos || pos.length < 9) return []

  const index = geometry.index?.array
  const triCount = index ? index.length / 3 : pos.length / 9
  const v0 = new THREE.Vector3()
  const v1 = new THREE.Vector3()
  const v2 = new THREE.Vector3()

  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index[t * 3] : t * 3
    const i1 = index ? index[t * 3 + 1] : t * 3 + 1
    const i2 = index ? index[t * 3 + 2] : t * 3 + 2
    v0.fromArray(pos, i0 * 3)
    v1.fromArray(pos, i1 * 3)
    v2.fromArray(pos, i2 * 3)
    fillProjectedTriangle(grid, spec.uBins, spec, projectToSection(v0, frame), projectToSection(v1, frame), projectToSection(v2, frame))
  }

  const contour = traceGridBoundary(grid, spec)
  return dedupePoints(contour, Math.max(spec.uStep, spec.vStep))
}

/**
 * Method 1 left-side cut silhouette (u ≤ 0), rear-anchored collimated shadow.
 * Prefers the true shadow contour; falls back to the per-v envelope.
 */
export function extractLeftSilhouette(geometry, frame, opts = {}) {
  const pos = geometry.attributes.position
  if (!pos || pos.count < 3) return []

  geometry.computeBoundingBox()
  const bbox = geometry.boundingBox
  if (!bbox || bbox.isEmpty()) return []

  const uMax = opts.uMax ?? 1e-3

  const contour = projectShadowContour(geometry, frame, bbox, opts.profileAccuracy ?? 5)
  if (contour.length >= 3) {
    const left = contour.filter((p) => p.u <= uMax)
    if (left.length >= 2) return left
  }

  const { left } = projectFrontToRearExtents(geometry, frame, bbox, opts)
  return dedupePoints(left.filter((p) => p.u <= uMax))
}

/**
 * Full front-to-rear silhouette — true shadow contour with concavities,
 * falling back to the per-v min/max envelope when no clean loop is found.
 */
export function extractFullSilhouette(geometry, frame, opts = {}) {
  const pos = geometry.attributes.position
  if (!pos || pos.count < 3) return []

  geometry.computeBoundingBox()
  const bbox = geometry.boundingBox
  if (!bbox || bbox.isEmpty()) return []

  const contour = projectShadowContour(geometry, frame, bbox, opts.profileAccuracy ?? 5, opts.gridBins ?? null)
  if (contour.length >= 3) return contour

  const extents = projectFrontToRearExtents(geometry, frame, bbox, opts)
  return mergeFullOutline(extents)
}

/** Stock → silhouette options for toolpath builders. */
export function silhouetteOptsFromStock(stock) {
  return { profileAccuracy: clampProfileAccuracy(stock?.profileAccuracy ?? 5) }
}

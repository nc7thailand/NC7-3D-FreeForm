// Silhouette extraction for rotary hot-wire cutting.
//
// Type A — front-to-rear orthographic projection (rays along −n through the
// mesh). Anchor is the rear cutting plane (Z = −T/2 at θ = 0).
//
// Full silhouette uses per-v min/max envelope bins (stable on mobile meshes).
// Silhouette-edge attempt saved at: src/lib/checkpoints/silhouette-edges-v1.js

import * as THREE from 'three'

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

function projectFrontToRearExtents(geometry, frame, bbox, vTol = 0.06) {
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

function mergeFullOutlineEnvelope({ left, right }) {
  if (left.length < 2 && right.length < 2) return []
  const leftSorted = [...left].sort((a, b) => a.v - b.v || a.u - b.u)
  const rightSorted = [...right].sort((a, b) => b.v - a.v || a.u - b.u)
  if (leftSorted.length >= 2 && rightSorted.length >= 2) {
    return dedupePoints([...leftSorted, ...rightSorted])
  }
  return dedupePoints(leftSorted.length >= 2 ? leftSorted : rightSorted)
}

function projectFrontToRearLeft(geometry, frame, bbox, vTol = 0.06) {
  return projectFrontToRearExtents(geometry, frame, bbox, vTol).left
}

/**
 * Method 1 left-side cut silhouette (u ≤ 0), rear-anchored projection.
 */
export function extractLeftSilhouette(geometry, frame, opts = {}) {
  const pos = geometry.attributes.position
  if (!pos || pos.count < 3) return []

  geometry.computeBoundingBox()
  const bbox = geometry.boundingBox
  if (!bbox || bbox.isEmpty()) return []

  const projected = projectFrontToRearLeft(geometry, frame, bbox, opts.vTol ?? 0.06)
  const uMax = opts.uMax ?? 1e-3
  const left = projected.filter((p) => p.u <= uMax)
  return dedupePoints(left)
}

/**
 * Full front-to-rear silhouette — min/max envelope (left + right outline).
 */
export function extractFullSilhouette(geometry, frame, opts = {}) {
  const pos = geometry.attributes.position
  if (!pos || pos.count < 3) return []

  geometry.computeBoundingBox()
  const bbox = geometry.boundingBox
  if (!bbox || bbox.isEmpty()) return []

  const extents = projectFrontToRearExtents(geometry, frame, bbox, opts.vTol ?? 0.06)
  return mergeFullOutlineEnvelope(extents)
}

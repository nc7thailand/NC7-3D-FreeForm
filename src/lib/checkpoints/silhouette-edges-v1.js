// Silhouette extraction for rotary hot-wire cutting.
//
// Type A — front-to-rear orthographic projection (rays along −n through the
// mesh). Anchor is the rear cutting plane (Z = −T/2 at θ = 0).
//
// Full silhouette uses view-dependent silhouette edges (captures concavities
// such as under the chin). Per-v min/max bins alone cannot represent concave
// pockets at the same height.

import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { linkSegments } from './slicer.js'

/** Weld STL soup so silhouette edges can be found between triangles. */
function weldedGeometry(geometry) {
  return mergeVertices(geometry, 1e-4)
}

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

function edgeKey(i, j) {
  return i < j ? `${i},${j}` : `${j},${i}`
}

/**
 * Map undirected mesh edges to adjacent triangle indices.
 *
 * @param {THREE.BufferGeometry} geometry
 * @returns {Map<string, number[]>}
 */
function buildEdgeToTriangles(geometry) {
  const index = geometry.index?.array
  const triCount = index ? index.length / 3 : geometry.attributes.position.count / 3
  const map = new Map()

  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index[t * 3] : t * 3
    const i1 = index ? index[t * 3 + 1] : t * 3 + 1
    const i2 = index ? index[t * 3 + 2] : t * 3 + 2
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const key = edgeKey(a, b)
      const list = map.get(key)
      if (list) list.push(t)
      else map.set(key, [t])
    }
  }
  return map
}

/**
 * Unit face normals for every triangle.
 *
 * @param {THREE.BufferGeometry} geometry
 * @returns {THREE.Vector3[]}
 */
function triangleNormals(geometry) {
  const pos = geometry.attributes.position.array
  const index = geometry.index?.array
  const triCount = index ? index.length / 3 : pos.length / 9
  const normals = []
  const v0 = new THREE.Vector3()
  const v1 = new THREE.Vector3()
  const v2 = new THREE.Vector3()
  const e1 = new THREE.Vector3()
  const e2 = new THREE.Vector3()

  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index[t * 3] : t * 3
    const i1 = index ? index[t * 3 + 1] : t * 3 + 1
    const i2 = index ? index[t * 3 + 2] : t * 3 + 2
    v0.fromArray(pos, i0 * 3)
    v1.fromArray(pos, i1 * 3)
    v2.fromArray(pos, i2 * 3)
    e1.subVectors(v1, v0)
    e2.subVectors(v2, v0)
    normals.push(new THREE.Vector3().crossVectors(e1, e2).normalize())
  }
  return normals
}

/**
 * View-dependent silhouette segments projected to section (u, v).
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {{ normal: THREE.Vector3, uAxis: THREE.Vector3, point: THREE.Vector3 }} frame
 * @returns {Array<[THREE.Vector3, THREE.Vector3]>}
 */
function silhouetteSegmentsUV(geometry, frame) {
  const viewDir = frame.normal
  const pos = geometry.attributes.position.array
  const faceNormals = triangleNormals(geometry)
  const edgeMap = buildEdgeToTriangles(geometry)
  const segments = []

  for (const [key, tris] of edgeMap) {
    const [ia, ib] = key.split(',').map(Number)
    const p0 = new THREE.Vector3().fromArray(pos, ia * 3)
    const p1 = new THREE.Vector3().fromArray(pos, ib * 3)
    const s0 = projectToSection(p0, frame)
    const s1 = projectToSection(p1, frame)
    const a = new THREE.Vector3(s0.u, s0.v, 0)
    const b = new THREE.Vector3(s1.u, s1.v, 0)
    if (a.distanceToSquared(b) < 1e-12) continue

    if (tris.length === 2) {
      const d0 = faceNormals[tris[0]].dot(viewDir)
      const d1 = faceNormals[tris[1]].dot(viewDir)
      if (d0 * d1 < 0) segments.push([a, b])
    } else if (tris.length === 1 && faceNormals[tris[0]].dot(viewDir) > 0) {
      segments.push([a, b])
    }
  }
  return segments
}

function polylineArea2D(pts) {
  if (pts.length < 3) return 0
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    area += pts[i].u * pts[j].v - pts[j].u * pts[i].v
  }
  return Math.abs(area) * 0.5
}

function uvPolylineToPoints(poly) {
  return poly.map((p) => ({ u: p.x, v: p.y }))
}

/**
 * Link silhouette segments into the largest closed UV loop.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {{ normal: THREE.Vector3, uAxis: THREE.Vector3, point: THREE.Vector3 }} frame
 * @returns {{ u: number, v: number }[]}
 */
function extractSilhouetteEdgesUV(geometry, frame) {
  const meshGeo = weldedGeometry(geometry)
  const segments = silhouetteSegmentsUV(meshGeo, frame)
  if (meshGeo !== geometry) meshGeo.dispose()
  if (!segments.length) return []

  const polylines = linkSegments(segments, 0.08)
  if (!polylines.length) return []

  let best = null
  let bestScore = -1
  for (const poly of polylines) {
    if (poly.length < 3) continue
    const pts = uvPolylineToPoints(poly)
    const closed = poly[0].distanceTo(poly[poly.length - 1]) < 0.15
    const score = polylineArea2D(pts) + (closed ? 1e6 : 0) + poly.length
    if (score > bestScore) {
      bestScore = score
      best = pts
    }
  }

  if (!best || best.length < 3) return []
  return dedupePoints(best, 0.04)
}

// --- Envelope fallback (left cut / backup) -----------------------------------

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
 * Full front-to-rear silhouette — silhouette edges (concave detail) with
 * envelope fallback.
 */
export function extractFullSilhouette(geometry, frame, opts = {}) {
  const pos = geometry.attributes.position
  if (!pos || pos.count < 3) return []

  geometry.computeBoundingBox()
  const bbox = geometry.boundingBox
  if (!bbox || bbox.isEmpty()) return []

  const edgeOutline = extractSilhouetteEdgesUV(geometry, frame)
  if (edgeOutline.length >= 3) return edgeOutline

  const extents = projectFrontToRearExtents(geometry, frame, bbox, opts.vTol ?? 0.06)
  return mergeFullOutlineEnvelope(extents)
}

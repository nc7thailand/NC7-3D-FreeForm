// STL slicing (cross-section extraction): intersect a triangle mesh with a
// plane and return the resulting line segments / connected polylines.
//
// These segments are the raw material for the 2D toolpath preview: the wire
// of the NC7 machine cuts the outline where the cutting plane meets the part.

import * as THREE from 'three'

const EPS = 1e-9

/**
 * Intersect a BufferGeometry with an infinite plane.
 *
 * Every triangle is classified against the plane using signed distances.
 * Edges that straddle the plane produce one intersection point each; a
 * triangle yields a single segment when exactly two edges cross it. Faces
 * lying entirely on the plane are skipped (their neighbours already emit the
 * boundary segments).
 *
 * @param {THREE.BufferGeometry} geometry - indexed or non-indexed mesh
 * @param {THREE.Vector3} normal   - plane normal (normalised internally)
 * @param {THREE.Vector3} point    - any point on the plane
 * @returns {Array<[THREE.Vector3, THREE.Vector3]>} unordered line segments
 */
export function sliceMeshByPlane(geometry, normal, point) {
  const posAttr = geometry.attributes.position
  if (!posAttr || posAttr.count < 3) return []

  const px = posAttr.array
  const index = geometry.index
  const ix = index ? index.array : null
  const triCount = ix ? ix.length / 3 : px.length / 3

  const nx = normal.x, ny = normal.y, nz = normal.z
  const ox = point.x, oy = point.y, oz = point.z
  // Signed plane function value for vertex at index i
  const signed = (i) =>
    nx * (px[i * 3] - ox) + ny * (px[i * 3 + 1] - oy) + nz * (px[i * 3 + 2] - oz)

  const segments = []
  const d = new Array(3)
  const inter = (a, b, da, db, out) => {
    const t = da / (da - db) // da and db have opposite signs
    out.set(
      px[a * 3] + t * (px[b * 3] - px[a * 3]),
      px[a * 3 + 1] + t * (px[b * 3 + 1] - px[a * 3 + 1]),
      px[a * 3 + 2] + t * (px[b * 3 + 2] - px[a * 3 + 2])
    )
  }

  const cross = new THREE.Vector3()
  const verts = []

  for (let t = 0; t < triCount; t++) {
    const i0 = ix ? ix[t * 3] : t * 3
    const i1 = ix ? ix[t * 3 + 1] : t * 3 + 1
    const i2 = ix ? ix[t * 3 + 2] : t * 3 + 2

    d[0] = signed(i0)
    d[1] = signed(i1)
    d[2] = signed(i2)

    // All on the same side -> triangle does not cross the plane
    const anyPos = d[0] > EPS || d[1] > EPS || d[2] > EPS
    const anyNeg = d[0] < -EPS || d[1] < -EPS || d[2] < -EPS
    if (!(anyPos && anyNeg)) continue

    verts.length = 0
    // Edge pairs in order: (0,1), (1,2), (2,0)
    const pairs = [
      [i0, i1, d[0], d[1]],
      [i1, i2, d[1], d[2]],
      [i2, i0, d[2], d[0]],
    ]
    for (const [a, b, da, db] of pairs) {
      const sameSign = (da > EPS && db > EPS) || (da < -EPS && db < -EPS)
      if (sameSign) continue
      // Guard against the vertex sitting exactly on the plane on both ends
      if (Math.abs(da) < EPS && Math.abs(db) < EPS) continue
      const p = new THREE.Vector3()
      inter(a, b, da, db, p)
      verts.push(p)
    }

    if (verts.length >= 2) {
      segments.push([verts[0], verts[1]])
    }
  }

  // When the mesh carries vertex normals that match the plane, we can leave
  // the points on the plane itself — cheap cleanup for degenerate duplicates.
  return segments
}

/**
 * Greedily connect a set of unordered segments into ordered polylines by
 * matching near-coincident endpoints.
 *
 * @param {Array<[THREE.Vector3, THREE.Vector3]>} segments
 * @param {number} tolerance - max distance (world units) between endpoints to join
 * @returns {Array<THREE.Vector3[]>} connected polylines (each with >= 2 points)
 */
export function linkSegments(segments, tolerance = 1e-5) {
  const tol = Math.max(tolerance, 1e-9)
  const tolSq = tol * tol
  const keyOf = (x, y, z) => {
    // Quantise to the tolerance grid so near-endpoints share a key
    const cell = 1 / tol
    return `${Math.round(x * cell)},${Math.round(y * cell)},${Math.round(z * cell)}`
  }

  // polylines are [ {pts: Vector3[], headKey, tailKey, reversed?} ... ]
  const chains = new Map() // endpointKey -> chainId
  const open = [] // { pts: [], head: Vector3, tail: Vector3 }
  const distSq = (a, b) => {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
    return dx * dx + dy * dy + dz * dz
  }

  const registerChain = (id, ch) => {
    chains.set(keyOf(ch.head.x, ch.head.y, ch.head.z), id)
    chains.set(keyOf(ch.tail.x, ch.tail.y, ch.tail.z), id)
  }

  const scrubChainId = (id) => {
    for (const [k, v] of chains.entries()) {
      if (v === id) chains.delete(k)
    }
  }

  const addChain = (pts) => {
    const ch = {
      pts,
      head: pts[0],
      tail: pts[pts.length - 1],
    }
    open.push(ch)
    const id = open.length - 1
    registerChain(id, ch)
    return id
  }

  const detachKey = (key) => {
    const idx = chains.get(key)
    if (idx === undefined) return
    const ch = open[idx]
    if (!ch) {
      chains.delete(key)
      return
    }
    chains.delete(key)
    chains.delete(keyOf(ch.head.x, ch.head.y, ch.head.z))
    chains.delete(keyOf(ch.tail.x, ch.tail.y, ch.tail.z))
  }

  const join = (aId, bId) => {
    const a = open[aId]
    const b = open[bId]
    if (!a || !b || aId === bId) return aId
    const options = [
      [a, a.pts.length - 1, b, 0],
      [a, 0, b, 0],
      [a, a.pts.length - 1, b, b.pts.length - 1],
      [a, 0, b, b.pts.length - 1],
    ]
    let best = options[0]
    let bestD = Infinity
    for (const opt of options) {
      const d = distSq(opt[0].pts[opt[1]], opt[2].pts[opt[3]])
      if (d < bestD) {
        bestD = d
        best = opt
      }
    }
    const [ca, ai, cb, bi] = best
    const ra = ai !== 0
    const rb = bi !== cb.pts.length - 1
    const pa = ra ? ca.pts.slice().reverse() : ca.pts
    const pb = rb ? cb.pts.slice().reverse() : cb.pts
    const merged = [...pa, ...pb]
    open[aId] = { pts: merged, head: merged[0], tail: merged[merged.length - 1] }
    scrubChainId(bId)
    open[bId] = null
    registerChain(aId, open[aId])
    return aId
  }

  const extendChain = (chainId, near, far) => {
    const ch = open[chainId]
    if (!ch) return
    const dHead = distSq(near, ch.head)
    const dTail = distSq(near, ch.tail)
    detachKey(keyOf(near.x, near.y, near.z))
    if (dHead < dTail) ch.pts.unshift(far)
    else ch.pts.push(far)
    ch.head = ch.pts[0]
    ch.tail = ch.pts[ch.pts.length - 1]
    registerChain(chainId, ch)
  }

  for (const [a, b] of segments) {
    if (!a || !b) continue
    const keyA = keyOf(a.x, a.y, a.z)
    const keyB = keyOf(b.x, b.y, b.z)
    const chainA = chains.get(keyA)
    const chainB = chains.get(keyB)

    if (chainA !== undefined && chainA === chainB && open[chainA]) continue

    if (chainA !== undefined && chainB !== undefined && open[chainA] && open[chainB]) {
      join(chainA, chainB)
      continue
    }

    if (chainA !== undefined && open[chainA]) {
      extendChain(chainA, a, b)
      continue
    }

    if (chainB !== undefined && open[chainB]) {
      extendChain(chainB, b, a)
      continue
    }

    addChain([a, b])
  }

  return open
    .filter((c) => c && c.pts.length >= 2)
    .map((c) => c.pts)
}

/**
 * Convenience: slice a mesh and immediately link the result.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {THREE.Vector3} normal
 * @param {THREE.Vector3} point
 * @param {number} [tol]
 * @returns {{ segments: Array, polylines: Array<THREE.Vector3[]> }}
 */
export function sliceAndLink(geometry, normal, point, tol = 1e-4) {
  const segments = sliceMeshByPlane(geometry, normal, point)
  const polylines = linkSegments(segments, tol)
  return { segments, polylines }
}

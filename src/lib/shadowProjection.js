// Shadow silhouette by collimated-light edge projection.
//
// DevFoam's documented technique (see docs/DevFoamLogic.md §1/§3): a projected
// section is the contour of the part's shadow on a plane under a collimated
// light. Practically that means projecting the mesh orthographically and
// intersecting mesh edges with horizontal scanlines.
//
// This is O(edges + intersections) — a few million operations — versus
// O(rays × triangles) for a brute-force ray grid (hundreds of millions), and it
// yields the sihouette as a polyline directly, with no raster step.
//
// Frame: light travels −Z. u = horizontal position on the plane, v = world Y.
import * as THREE from 'three'
import { traceGridBoundary } from './gridContour.js'

const SHADOW_Z_EXTRA = 100

/**
 * Shadow plane descriptor for a geometry at rotation θ.
 *
 * The grid must span the model, not the world origin: the model stands on the
 * floor (Y = 0 … height) while rotation about Y leaves the vertical extent
 * unchanged. Horizontally, rotating about Y mixes the model's X and Z extents,
 * so the width follows whichever is wider at that angle.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {number} thetaDeg
 * @param {number} [scanlines=160]
 */
export function shadowPlaneFor(geometry, thetaDeg, scanlines = 160) {
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  const size = new THREE.Vector3()
  bb.getSize(size)
  const centre = bb.getCenter(new THREE.Vector3())

  const rotationY = (thetaDeg * Math.PI) / 180
  const dgl = Math.hypot(size.x, size.y) + SHADOW_Z_EXTRA

  const cos = Math.abs(Math.cos(rotationY))
  const sin = Math.abs(Math.sin(rotationY))
  const projectedWidth = size.x * cos + size.z * sin

  const margin = 1.5
  const halfW = projectedWidth * 0.5 * margin
  const halfH = size.y * 0.5 * margin

  const step = (size.y * margin) / scanlines

  return {
    z: dgl / 2,
    centreY: centre.y,
    uMin: -halfW,
    uMax: halfW,
    vMin: centre.y - halfH,
    vMax: centre.y + halfH,
    scanlines,
    stepY: step,
    projectedWidth,
    rotationY,
    size: dgl,
  }
}

function rotateY(x, z, cos, sin) {
  return { x: x * cos + z * sin, z: -x * sin + z * cos }
}

/**
 * Project the mesh onto the shadow plane and return the silhouette outline.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {object} plane - from shadowPlaneFor
 * @param {{ closeLoop?: boolean }} [options]
 * @returns {{ outline: number[], left: number[], right: number[], occupied: number }}
 *   outline is a flat [u,v,u,v,…] polyline; left/right are per-scanline extremes.
 */
export function projectShadowOutline(geometry, plane) {
  const pos = geometry.attributes.position
  if (!pos || pos.count < 3) return { outline: [], left: [], right: [], occupied: 0 }

  const { scanlines, vMin, vMax, stepY, uMin, uMax, rotationY } = plane
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)

  // Per-scanline extremes. A scanline is "occupied" only when a mesh edge
  // actually crosses it, so gaps in the silhouette stay gaps.
  const minU = new Float64Array(scanlines).fill(Infinity)
  const maxU = new Float64Array(scanlines).fill(-Infinity)

  const index = geometry.index
  const vCount = pos.count
  const triCount = index ? index.count / 3 : vCount / 3

  // Rotate every vertex once into the light frame.
  const vx = new Float64Array(vCount)
  const vy = new Float64Array(vCount)
  for (let i = 0; i < vCount; i++) {
    const r = rotateY(pos.getX(i), pos.getZ(i), cos, sin)
    vx[i] = r.x
    vy[i] = pos.getY(i)
  }

  const stamp = (au, av, bu, bv) => {
    const dv = bv - av
    if (Math.abs(dv) < 1e-9) {
      // Horizontal edge: it contributes only at its own height.
      if (av < vMin || av > vMax) return
      const row = Math.min(scanlines - 1, Math.max(0, Math.floor((av - vMin) / stepY)))
      const uLo = Math.min(au, bu)
      const uHi = Math.max(au, bu)
      if (uLo < minU[row]) minU[row] = uLo
      if (uHi > maxU[row]) maxU[row] = uHi
      return
    }
    // Only scanlines that the edge actually spans.
    const t0 = (vMin - av) / dv
    const t1 = (vMax - av) / dv
    const tLo = Math.max(0, Math.min(t0, t1))
    const tHi = Math.min(1, Math.max(t0, t1))
    if (tHi < tLo) return

    const vStart = av + tLo * dv
    const vEnd = av + tHi * dv
    let rowA = Math.floor((vStart - vMin) / stepY)
    let rowB = Math.floor((vEnd - vMin) / stepY)
    if (rowA > rowB) { const t = rowA; rowA = rowB; rowB = t }

    for (let row = Math.max(0, rowA); row <= Math.min(scanlines - 1, rowB); row++) {
      const v = vMin + (row + 0.5) * stepY
      const t = (v - av) / dv
      if (t < -1e-6 || t > 1 + 1e-6) continue
      const u = au + t * (bu - au)
      if (u < minU[row]) minU[row] = u
      if (u > maxU[row]) maxU[row] = u
    }
  }

  const a = { u: 0, v: 0 }
  const b = { u: 0, v: 0 }
  for (let f = 0; f < triCount; f++) {
    const i0 = index ? index.getX(f * 3) : f * 3
    const i1 = index ? index.getX(f * 3 + 1) : f * 3 + 1
    const i2 = index ? index.getX(f * 3 + 2) : f * 3 + 2
    const verts = [i0, i1, i2]
    for (let k = 0; k < 3; k++) {
      const p = verts[k]
      const q = verts[(k + 1) % 3]
      a.u = vx[p]; a.v = vy[p]
      b.u = vx[q]; b.v = vy[q]
      // Cheap reject: skip edges outside the plane's box entirely.
      if ((a.v < vMin && b.v < vMin) || (a.v > vMax && b.v > vMax)) continue
      if ((a.u < uMin && b.u < uMin) || (a.u > uMax && b.u > uMax)) continue
      stamp(a.u, a.v, b.u, b.v)
    }
  }

  // Build a filled occupancy grid from the per-scanline extremes, then trace the
  // true shadow contour (concavity-preserving) via the shared tracer.
  const left = []
  const right = []
  for (let row = 0; row < scanlines; row++) {
    const v = vMin + (row + 0.5) * stepY
    if (minU[row] < Infinity) left.push(minU[row], v)
    if (maxU[row] > -Infinity) right.push(maxU[row], v)
  }

  if (left.length === 0 && right.length === 0) {
    return { outline: [], left, right, occupied: 0 }
  }

  // Synthesize a 2D grid spec for the tracer from the scanline/plane extents.
  const uSpan = uMax - uMin
  const uCells = Math.max(2, Math.round(uSpan / stepY)) // square-ish cells
  const uStep = uSpan / uCells
  const vBins = scanlines
  const uBins = uCells
  const grid = new Uint8Array(uBins * vBins)
  for (let row = 0; row < scanlines; row++) {
    if (minU[row] >= Infinity) continue
    const uLo = Math.max(0, Math.floor((minU[row] - uMin) / uStep))
    const uHi = Math.min(uBins - 1, Math.floor((maxU[row] - uMin) / uStep))
    for (let c = uLo; c <= uHi; c++) grid[row * uBins + c] = 1
  }

  const spec = { uMin, vMin, uStep, vStep: stepY, uBins, vBins }
  const contour = traceGridBoundary(grid, spec)
  const outline = []
  for (const p of contour) { outline.push(p.u, p.v) }

  return { outline, left, right, occupied: left.length / 2 }
}

export function shadowDistanceFromSize(size) {
  return Math.hypot(size.x, size.y) + SHADOW_Z_EXTRA
}

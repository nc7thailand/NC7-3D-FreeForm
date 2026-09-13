// Shadow plane + collimated ray cast for the Toolpath page.
//
// Bank's physical thought experiment:
//  - Model sits centred on the turntable (no translation), rotated by θ.
//  - Light is collimated, travelling +Z → −Z (fixed direction).
//  - A "shadow plane" is fixed at Z = + (dgl/2 + 100), sized to the model's
//    bounding box plus 50% margin, centred on the model's Y centre.
//  - Rays are cast from the plane through the model; a ray that hits any
//    triangle casts a shadow point. The result is a 2D silhouette in the
//    plane's local XY coordinates, traced into an outline polyline.
//  - dgl = hypot(sizeX, sizeY) + 100  (experimental — tune later).
import * as THREE from 'three'

/** Fixed shadow-plane offset from the model base, mm. */
const SHADOW_Z_EXTRA = 100

/**
 * Diagonal-based shadow plane distance (experimental formula).
 * @param {{x:number, y:number}} size
 * @returns {number}
 */
export function shadowDistanceFromSize(size) {
  return Math.hypot(size.x, size.y) + SHADOW_Z_EXTRA
}

/**
 * Ray/triangle intersection (Möller–Trumbore).
 */
function rayTri(origin, dir, a, b, c) {
  const edge1 = _e1.subVectors(b, a)
  const edge2 = _e2.subVectors(c, a)
  const h = _h.crossVectors(dir, edge2)
  const det = edge1.dot(h)
  if (det > -1e-9 && det < 1e-9) return null
  const inv = 1 / det
  const s = _s.subVectors(origin, a)
  const u = inv * s.dot(h)
  if (u < 0 || u > 1) return null
  const q = _q.crossVectors(s, edge1)
  const v = inv * dir.dot(q)
  if (v < 0 || u + v > 1) return null
  const t = inv * edge2.dot(q)
  return t > 1e-9 ? t : null
}

const _e1 = new THREE.Vector3()
const _e2 = new THREE.Vector3()
const _h = new THREE.Vector3()
const _s = new THREE.Vector3()
const _q = new THREE.Vector3()
const _dir = new THREE.Vector3(0, 0, -1)

/**
 * Build a shadow plane descriptor for a geometry and rotation angle.
 * The plane is in WORLD space, centred vertically on the model centre.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {number} thetaDeg
 * @param {number} [grid=96]
 */
export function shadowPlaneFor(geometry, thetaDeg, grid = 96) {
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  const size = new THREE.Vector3()
  bb.getSize(size)
  const centre = bb.getCenter(new THREE.Vector3())

  const dgl = shadowDistanceFromSize({ x: size.x, y: size.y })
  const z = dgl / 2

  const rotationY = (thetaDeg * Math.PI) / 180

  // Rotating about Y turns the model's breadth into a mix of its X and Z
  // extents, so the shadow's width must be derived from both. Using sizeX alone
  // clips the outline on parts whose thickness exceeds their width.
  const shadowWidth = Math.abs(size.x * Math.cos(rotationY)) + Math.abs(size.z * Math.sin(rotationY))
  const halfW = shadowWidth * 0.5 * 1.5

  // The grid must span the model, not the world origin: the model stands on the
  // floor (Y = 0 … height), so a grid centred on Y = 0 would only cover its
  // lower portion. Rotation about Y does not change the vertical extent.
  const halfH = size.y * 0.5 * 1.5
  const uMin = -halfW
  const uMax = halfW
  const vMin = centre.y - halfH
  const vMax = centre.y + halfH

  // Keep cells square so the outline is not stretched, and let the requested
  // count drive the finer of the two axes.
  const step = Math.min((uMax - uMin), (vMax - vMin)) / grid
  const nx = Math.max(2, Math.round((uMax - uMin) / step))
  const ny = Math.max(2, Math.round((vMax - vMin) / step))

  return {
    z,
    centreY: centre.y,
    uMin,
    uMax,
    vMin,
    vMax,
    nx,
    ny,
    stepX: (uMax - uMin) / nx,
    stepY: (vMax - vMin) / ny,
    rotationY,
    size: dgl,
  }
}

/**
 * Cast collimated rays and produce a filled occupancy grid (in/out shadow).
 * Rotates geometry by −θ into the base frame where light travels −Z.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {object} plane - from shadowPlaneFor
 * @returns {Uint8Array} flat grid, 1 = shadow, length nx*ny
 */
export function castShadowGrid(geometry, plane) {
  const { nx, ny } = plane
  const grid = new Uint8Array(nx * ny)

  const pos = geometry.attributes.position
  if (!pos || pos.count < 3) return grid
  const index = geometry.index
  const triCount = index ? index.count / 3 : pos.count / 3

  // Pre-rotate the model by the SAME angle the viewer applies to the mesh, so
  // the shadow matches the orientation on screen. Rotating by the opposite sign
  // mirrored the outline. Light always travels −Z in this frame.
  const cos = Math.cos(plane.rotationY)
  const sin = Math.sin(plane.rotationY)
  const verts = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const zz = pos.getZ(i)
    verts[i * 3] = x * cos + zz * sin
    verts[i * 3 + 1] = y
    verts[i * 3 + 2] = -x * sin + zz * cos
  }

  const { uMin, vMax, stepX, stepY, z } = plane
  const origin = _o
  const a = _a, b = _b, c = _c
  const dir = _dir

  for (let j = 0; j < ny; j++) {
    const y = vMax - (j + 0.5) * stepY
    const row = j * nx
    for (let i = 0; i < nx; i++) {
      const x = uMin + (i + 0.5) * stepX
      origin.set(x, y, z)
      let hit = false
      for (let t = 0; t < triCount && !hit; t++) {
        const ia = index ? index.getX(t * 3) : t * 3
        const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1
        const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2
        a.set(verts[ia * 3], verts[ia * 3 + 1], verts[ia * 3 + 2])
        b.set(verts[ib * 3], verts[ib * 3 + 1], verts[ib * 3 + 2])
        c.set(verts[ic * 3], verts[ic * 3 + 1], verts[ic * 3 + 2])
        if (rayTri(origin, dir, a, b, c) !== null) { hit = true; break }
      }
      if (hit) grid[row + i] = 1
    }
  }
  return grid
}

const _o = new THREE.Vector3()
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _c = new THREE.Vector3()

/**
 * Trace the outer boundary of a filled grid via a simple marching-squares
 * of the "on" cells, returning a world-space polyline (flat array [x,y,…]).
 * Produces an ordered outline robust enough for display.
 *
 * @param {Uint8Array} grid
 * @param {object} plane
 * @returns {number[]}
 */
export function traceShadowOutline(grid, plane) {
  const { nx, ny, uMin, vMax, stepX, stepY } = plane

  // Find boundary cells: an ON cell adjacent to an OFF cell (or grid edge).
  const isOn = (i, j) => i >= 0 && i < nx && j >= 0 && j < ny && grid[j * nx + i] === 1
  const isBoundary = (i, j) => {
    if (!isOn(i, j)) return false
    return !isOn(i - 1, j) || !isOn(i + 1, j) || !isOn(i, j - 1) || !isOn(i, j + 1)
  }

  const cellX = (i) => uMin + (i + 0.5) * stepX
  const cellY = (j) => vMax - (j + 0.5) * stepY

  // Collect boundary points unordered, then sort by angle around the centroid
  // to produce a simple outline polygon (display only; not exact contour).
  const pts = []
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (isBoundary(i, j)) pts.push([cellX(i), cellY(j)])
    }
  }
  if (pts.length < 3) return []

  let cx = 0, cy = 0
  for (const [x, y] of pts) { cx += x; cy += y }
  cx /= pts.length
  cy /= pts.length

  pts.sort((p, q) => Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx))

  // Downsample to reduce point count (keep ~1 point per step across the board).
  const out = []
  for (const [x, y] of pts) out.push(x, y)
  return out
}

// Toolpath planning math for the NC7 machine.
//
// Axis convention used by the CAM UI:
//   - World Y is the vertical travel axis of the machine (up = +Y).
//   - The cutting plane is a vertical plane that can rotate around the Y axis
//     by an angle θ (the rotary / indexed cut direction).
//   - The foam block stock has Width W (world X), Thickness T (world Z) and
//     Height H (world Y). At θ = 0 the cutting plane is parallel to X.
//
// Dynamic BB / LB formulas (from CONCEPT.md §3.2):
//   Block_Bottom_Extent(θ) = |(W/2)·sin θ| + |(T/2)·cos θ| + LO
//   LB(θ)                  = Block_Bottom_Extent(θ) + BO
//
// BO (experimental): bottom of the model axis-aligned bounding box (world Y),
// not a separate user margin. stock.bo is synced from geometry on Apply.

import * as THREE from 'three'
import { extractLeftSilhouette, extractFullSilhouette, silhouetteOptsFromStock } from './silhouette.js'

export { silhouetteOptsFromStock }

export const DEG = Math.PI / 180

export function toRadians(deg) {
  return deg * DEG
}

/** Base back centre of the foam block — cutting plane anchor (Z = -T/2). */
export function planePointFromStock({ t }) {
  return new THREE.Vector3(0, 0, -t / 2)
}

/** Centre of foam block thickness — middle plane anchor (Z = 0). */
export function planePointMiddleFromStock() {
  return new THREE.Vector3(0, 0, 0)
}

/**
 * Cutting plane for a given angle θ (degrees).
 *
 * The plane is vertical, contains the vertical axis through `point`, and its
 * normal lies in the X–Z plane, rotating with θ (θ = 0 -> plane faces +Z, i.e.
 * it is parallel to the X axis / spans width W).
 *
 * @param {number} thetaDeg
 * @param {THREE.Vector3} point - anchor at base back centre of stock (0, 0, -T/2)
 * @returns {{ normal: THREE.Vector3, uAxis: THREE.Vector3, point: THREE.Vector3 }}
 */
export function cuttingPlane(thetaDeg, point = new THREE.Vector3(0, 0, 0)) {
  const r = toRadians(thetaDeg)
  const normal = new THREE.Vector3(Math.sin(r), 0, Math.cos(r))
  // Horizontal axis along the plane (tangent direction)
  const uAxis = new THREE.Vector3(Math.cos(r), 0, -Math.sin(r))
  return { normal, uAxis, point: point.clone() }
}

/**
 * Convert a world point on the slice to 2D canvas coordinates.
 *
 * u = signed distance from the plane anchor along the plane's horizontal axis
 * v = height above the anchor (world Y).
 *
 * @param {THREE.Vector3} p
 * @param {{ point: THREE.Vector3, uAxis: THREE.Vector3 }} frame
 * @returns {{ u: number, v: number }}
 */
export function projectToSection(p, frame) {
  const dx = p.x - frame.point.x
  const dy = p.y - frame.point.y
  const dz = p.z - frame.point.z
  return {
    u: dx * frame.uAxis.x + dz * frame.uAxis.z,
    v: dy,
  }
}

/**
 * Block_Bottom_Extent(θ) from CONCEPT.md.
 * Half-height of the rotated stock cross-section below centre, plus the wire
 * clearance offset LO.
 *
 * @param {number} thetaDeg
 * @param {{ w: number, t: number, lo: number }} block
 * @returns {number} extent in mm
 */
export function blockBottomExtent(thetaDeg, { w, t, lo }) {
  const r = toRadians(thetaDeg)
  return Math.abs((w / 2) * Math.sin(r)) + Math.abs((t / 2) * Math.cos(r)) + lo
}

/**
 * BO — bottom of the model axis-aligned bbox in foam-block space (Y=0 floor).
 *
 * @param {THREE.BufferGeometry|null|undefined} geometry
 * @returns {number}
 */
export function modelBBoxBottomY(geometry) {
  if (!geometry) return 0
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  if (!bb || bb.isEmpty()) return 0
  return bb.min.y
}

/**
 * Resolve BO for overlay / LB. Prefers live geometry; falls back to stock.bo
 * snapshot (saved cut jobs).
 *
 * @param {object} [stock]
 * @param {THREE.BufferGeometry|null|undefined} geometry
 */
export function resolveBo(stock, geometry) {
  if (geometry) return modelBBoxBottomY(geometry)
  return stock?.bo ?? 0
}

/**
 * LB(θ) — the dynamic bottom safe point: lowest wire travel required below
 * the rotation axis, from CONCEPT.md.
 *
 * @param {number} thetaDeg
 * @param {{ w: number, t: number, lo: number, bo: number }} block
 * @returns {number} distance in mm (>= 0)
 */
export function bottomSafeOffset(thetaDeg, { w, t, lo, bo }) {
  return blockBottomExtent(thetaDeg, { w, t, lo }) + bo
}

/**
 * Auto bottom safe total depth (CONCEPT v1): hypot(W,T,H)/2 + margin.
 *
 * @param {{ w: number, t: number, h: number, boMargin?: number }} stock
 */
export function defaultBottomSafeTotal(stock) {
  const margin = stock.boMargin ?? 20
  return Math.hypot(stock.w, stock.t, stock.h) / 2 + margin
}

/**
 * Effective LB for display / retract — auto or manual BO formula.
 *
 * @param {number} thetaDeg
 * @param {object} stock
 */
export function effectiveBottomSafeOffset(thetaDeg, stock, geometry) {
  const bo = resolveBo(stock, geometry)
  if (stock.boAuto !== false) {
    return defaultBottomSafeTotal(stock)
  }
  return bottomSafeOffset(thetaDeg, { w: stock.w, t: stock.t, lo: stock.lo, bo })
}

/**
 * Horizontal half-width of the (axis-aligned) stock block measured along the
 * cutting plane at angle θ. Used to draw the stock boundary in the 2D section.
 *
 * @param {number} thetaDeg
 * @param {{ w: number, t: number }} block
 * @returns {number} half width in mm
 */
export function blockSectionHalfWidth(thetaDeg, { w, t }) {
  const r = toRadians(thetaDeg)
  return Math.abs((w / 2) * Math.cos(r)) + Math.abs((t / 2) * Math.sin(r))
}

/**
 * Slice the working geometry with the vertical cutting plane at θ and project
 * the resulting polylines into the plane's 2D section coordinates.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {number} thetaDeg
 * @param {THREE.Vector3} planePoint - anchor at base back centre (0, 0, -T/2)
 * @returns {{ polylines: Array<{u: number, v: number}[]>, pointCount: number }}
 */
/**
 * Clone geometry and optionally bake a world matrix (e.g. gizmo transform).
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {THREE.Matrix4|null} [worldMatrix]
 * @returns {THREE.BufferGeometry}
 */
export function geometryForSlicing(geometry, worldMatrix = null) {
  const g = geometry.clone()
  if (worldMatrix) g.applyMatrix4(worldMatrix)
  return g
}

/**
 * Clone for CAM slicing — optional virtual floor settle (Y_min → 0) without mutating source mesh.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {THREE.Matrix4|null} [worldMatrix]
 * @param {{ floorSettle?: boolean }} [options]
 */
export function geometryForToolpathSlicing(geometry, worldMatrix = null, { floorSettle = true } = {}) {
  const g = geometryForSlicing(geometry, worldMatrix)
  if (!floorSettle) return g
  g.computeBoundingBox()
  const minY = g.boundingBox?.min.y ?? 0
  if (minY < -1e-6) {
    g.translate(0, -minY, 0)
    g.computeBoundingBox()
  }
  return g
}

/** Y offset to place a centroid-centered mesh on the foam floor (Y = 0). */
export function floorOffsetY(geometry) {
  if (!geometry) return 0
  geometry.computeBoundingBox()
  const minY = geometry.boundingBox?.min.y ?? 0
  return minY < -1e-6 ? -minY : 0
}

/**
 * Map 2D section coordinates back to a world point on the cutting plane.
 *
 * @param {{ u: number, v: number }} p
 * @param {{ point: THREE.Vector3, uAxis: THREE.Vector3 }} frame
 * @returns {THREE.Vector3}
 */
export function unprojectFromSection(p, frame) {
  return new THREE.Vector3(
    frame.point.x + p.u * frame.uAxis.x,
    frame.point.y + p.v,
    frame.point.z + p.u * frame.uAxis.z
  )
}

/**
 * Build the Method 1 left-side cut profile at θ.
 *
 * Silhouette is the front-to-rear orthographic projection onto the rear
 * cutting plane (rays along −n; at θ = 0 this is +Z → −Z onto Z = −T/2),
 * then the left envelope (u ≤ 0). The wire still cuts from the left.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {number} thetaDeg
 * @param {THREE.Vector3} planePoint - anchor at base back centre (0, 0, -T/2)
 * @param {THREE.Matrix4|null} [worldMatrix] - optional gizmo/world transform
 * @returns {{ polylines: Array<{u: number, v: number}[]>, pointCount: number, frame: object, source: string }}
 */
export function buildSectionProfile(geometry, thetaDeg, planePoint, worldMatrix = null, opts = {}) {
  const sliceGeo = geometryForToolpathSlicing(geometry, worldMatrix)
  const frame = cuttingPlane(thetaDeg, planePoint)
  const silhouette = extractLeftSilhouette(sliceGeo, frame, opts)
  sliceGeo.dispose()
  const polylines = silhouette.length >= 2 ? [silhouette] : []
  return {
    polylines,
    pointCount: silhouette.length,
    frame,
    source: 'front-rear-shadow',
  }
}

/**
 * u-shift from rear anchor to middle anchor (same θ, parallel planes).
 * Keeps rear projection math but places the outline on MP without eccentric drift.
 *
 * @param {{ u: number, v: number }[]} points
 * @param {{ point: THREE.Vector3, uAxis: THREE.Vector3 }} rearFrame
 * @returns {{ u: number, v: number }[]}
 */
export function shiftSectionToMiddleAnchor(points, rearFrame) {
  const middlePoint = planePointMiddleFromStock()
  const dx = middlePoint.x - rearFrame.point.x
  const dz = middlePoint.z - rearFrame.point.z
  // u_mid = dot(p − middle, uAxis) = u_rear − dot(middle − rear, uAxis)
  const uShift = dx * rearFrame.uAxis.x + dz * rearFrame.uAxis.z
  return points.map((p) => ({ u: p.u - uShift, v: p.v }))
}

/**
 * Full front-to-rear silhouette projected at the rear anchor, displayed on MP.
 * MP frame pivots on the vertical axis through (0, 0, 0) — machine rotary axis.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {number} thetaDeg
 * @param {THREE.Vector3} rearPlanePoint - rear anchor (0, 0, −T/2)
 * @param {THREE.Matrix4|null} [worldMatrix]
 */
export function buildFullSilhouettePreview(geometry, thetaDeg, rearPlanePoint, worldMatrix = null, opts = {}) {
  const sliceGeo = geometryForToolpathSlicing(geometry, worldMatrix)
  // DISPLAY-ONLY θ flip. The frame's normal/uAxis are built from θ as though
  // the camera orbits the model by +θ, but physically the model turns by +θ on
  // a fixed wire. The two agree only at θ = 0; at every other angle the display
  // came out mirrored against the 3D view. Negating θ here corrects the 2D
  // contour, its middle-plane anchor, and the u-shift between them together.
  //
  // buildSectionProfile is deliberately NOT flipped — it feeds the G-code
  // pipeline, whose direction is reconciled against the DevFoam golden
  // separately. Display and G-code therefore differ in orientation for now.
  const displayTheta = -thetaDeg
  const rearFrame = cuttingPlane(displayTheta, rearPlanePoint)
  const outline = extractFullSilhouette(sliceGeo, rearFrame, opts)
  sliceGeo.dispose()
  const middleFrame = cuttingPlane(displayTheta, planePointMiddleFromStock())
  const displayPoly = shiftSectionToMiddleAnchor(outline, rearFrame)
  const polylines = displayPoly.length >= 2 ? [displayPoly] : []
  return {
    polylines,
    pointCount: displayPoly.length,
    frame: middleFrame,
    rearFrame,
    source: 'full-silhouette-preview',
  }
}

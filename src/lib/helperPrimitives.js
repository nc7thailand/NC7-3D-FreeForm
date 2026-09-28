// Parametric helper meshes for Object Placement (P4). Sizes in mm.

import * as THREE from 'three'

function boxGeometry(w, h, d, centerX, centerY, centerZ) {
  const geo = new THREE.BoxGeometry(w, h, d)
  geo.translate(centerX, centerY, centerZ)
  geo.computeBoundingBox()
  return geo
}

/**
 * Base plate sized to parent artwork bbox (+ margin), sitting below Y=0 top at floor.
 *
 * @param {THREE.BufferGeometry} parentGeometry
 */
export function createBasePlateForParent(parentGeometry, { marginMm = 20, thicknessMm = 8 } = {}) {
  parentGeometry.computeBoundingBox()
  const bb = parentGeometry.boundingBox
  const w = (bb.max.x - bb.min.x) + marginMm * 2
  const d = (bb.max.z - bb.min.z) + marginMm * 2
  const cx = (bb.min.x + bb.max.x) / 2
  const cz = (bb.min.z + bb.max.z) / 2
  return boxGeometry(w, thicknessMm, d, cx, -thicknessMm / 2, cz)
}

/** Bridge bar spanning parent width. */
export function createBridgeBarForParent(parentGeometry, { barW = 20, barH = 40, marginMm = 10 } = {}) {
  parentGeometry.computeBoundingBox()
  const bb = parentGeometry.boundingBox
  const span = (bb.max.x - bb.min.x) + marginMm * 2
  const cx = (bb.min.x + bb.max.x) / 2
  const cz = (bb.min.z + bb.max.z) / 2
  const topY = bb.max.y + barH / 2
  return boxGeometry(span, barH, barW, cx, topY, cz)
}

/** Vertical cylinder helper (diameter × height mm). */
export function createCylinderHelper(diameterMm, heightMm, centerX, centerZ, baseY = 0) {
  const geo = new THREE.CylinderGeometry(diameterMm / 2, diameterMm / 2, heightMm, 24)
  geo.translate(centerX, baseY + heightMm / 2, centerZ)
  geo.computeBoundingBox()
  return geo
}

export function createDefaultCylinderForParent(parentGeometry, { diameterMm = 30, heightMm = 60 } = {}) {
  parentGeometry.computeBoundingBox()
  const bb = parentGeometry.boundingBox
  const cx = (bb.min.x + bb.max.x) / 2
  const cz = bb.max.z + diameterMm
  return createCylinderHelper(diameterMm, heightMm, cx, cz, bb.min.y)
}

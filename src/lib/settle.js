// Settle utilities — drop the model so its bounding-box bottom touches Y=0.

import * as THREE from 'three'

/**
 * Drop geometry onto the floor plane (Y = 0).
 * Optionally bakes a world matrix first so gizmo move/rotate is preserved.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {{ worldMatrix?: THREE.Matrix4 }} [options]
 * @returns {THREE.BufferGeometry}
 */
export function settleGeometry(geometry, { worldMatrix = null } = {}) {
  if (worldMatrix) {
    geometry.applyMatrix4(worldMatrix)
  }

  geometry.computeBoundingBox()
  geometry.translate(0, -geometry.boundingBox.min.y, 0)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  return geometry
}

/**
 * Bake gizmo move/rotate into vertex data without changing floor height.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {THREE.Matrix4|null} worldMatrix
 * @returns {THREE.BufferGeometry}
 */
function isIdentityMatrix(m) {
  if (!m || !m.elements) return true
  const e = m.elements
  return (
    e[0] === 1 && e[1] === 0 && e[2] === 0 && e[3] === 0 &&
    e[4] === 0 && e[5] === 1 && e[6] === 0 && e[7] === 0 &&
    e[8] === 0 && e[9] === 0 && e[10] === 1 && e[11] === 0 &&
    e[12] === 0 && e[13] === 0 && e[14] === 0 && e[15] === 1
  )
}

export function bakeMeshTransform(geometry, worldMatrix = null) {
  if (worldMatrix && !isIdentityMatrix(worldMatrix)) {
    geometry.applyMatrix4(worldMatrix)
    geometry.computeVertexNormals()
    geometry.computeBoundingBox()
  }
  return geometry
}

/** Alias kept for clarity in new call sites. */
export const settleToFloor = settleGeometry

/**
 * Drop geometry onto Y=0 if its bbox bottom is below the floor. Returns true when translated.
 *
 * @param {THREE.BufferGeometry} geometry
 * @returns {boolean}
 */
export function ensureGeometryOnFloor(geometry) {
  if (!geometry) return false
  geometry.computeBoundingBox()
  const minY = geometry.boundingBox?.min.y ?? 0
  if (minY >= -1e-6) return false
  geometry.translate(0, -minY, 0)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  return true
}

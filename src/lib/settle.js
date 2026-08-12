// Auto-orient (settle) utilities: align the model's largest flat face
// onto the flat cutting plane (bottom, Y=0).

import * as THREE from 'three'

/**
 * Compute per-face area weights and face normals for a BufferGeometry.
 *
 * @param {THREE.BufferGeometry} geometry
 * @returns {{center: THREE.Vector3, avgNormal: THREE.Vector3, area: number}}
 */
function calculateFaceProperties(geometry) {
  const position = geometry.attributes.position
  const center = new THREE.Vector3()
  const avgNormal = new THREE.Vector3()
  let area = 0
  let totalNormalArea = 0

  const vA = new THREE.Vector3()
  const vB = new THREE.Vector3()
  const vC = new THREE.Vector3()
  const normal = new THREE.Vector3()

  if (!position) {
    return { center, avgNormal, area }
  }

  const triCount = position.count / 3
  for (let i = 0; i < triCount; i++) {
    vA.fromBufferAttribute(position, i * 3)
    vB.fromBufferAttribute(position, i * 3 + 1)
    vC.fromBufferAttribute(position, i * 3 + 2)

    // Face area via cross product
    const ab = vB.clone().sub(vA)
    const ac = vC.clone().sub(vA)
    normal.crossVectors(ab, ac)
    const faceArea = normal.length() / 2
    area += faceArea

    // Weighted normal by area
    normal.normalize()
    avgNormal.addScaledVector(normal, faceArea)
    totalNormalArea += faceArea

    // Accumulate triangle centroid for center-of-mass
    center.add(vA).add(vB).add(vC)
  }

  const vertexCount = position.count
  if (vertexCount > 0) center.divideScalar(vertexCount)
  if (totalNormalArea > 0) avgNormal.divideScalar(totalNormalArea)

  return { center, avgNormal, area }
}

/**
 * Auto-orient the geometry so its largest flat face (dominant face)
 * is aligned to the +Y (up) direction, effectively "settling" the model
 * onto a flat sectioning plane.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {{}} options
 * @returns {THREE.BufferGeometry} the same (mutated) geometry
 */
export function settleGeometry(geometry, options = {}) {
  const { center, avgNormal } = calculateFaceProperties(geometry)

  if (avgNormal.lengthSq() < 1e-12) {
    // Degenerate / no valid normal — no-op
    console.warn('Settle: no valid dominant surface found, skipping auto-orient.')
    return geometry
  }

  // Target: align dominant face normal with +Y (up)
  const targetUp = new THREE.Vector3(0, 1, 0)
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    avgNormal.clone().normalize(),
    targetUp
  )

  // Rotate geometry vertices
  geometry.applyQuaternion(quaternion)

  // Optionally center the model so it sits on the bottom (Y=0)
  if (options.centerOnOrigin !== false) {
    geometry.computeBoundingBox()
    const box = geometry.boundingBox
    const y = box.min.y
    // Shift so bottom touches the Y=0 plane
    geometry.translate(0, -y, 0)
  }

  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  return geometry
}

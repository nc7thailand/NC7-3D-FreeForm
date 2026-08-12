// Export helpers — write geometry to a binary STL file for download.

import * as THREE from 'three'

/**
 * Export a BufferGeometry to a binary .stl file and trigger download.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {string} filename
 */
export function exportSTL(geometry, filename = 'model.stl') {
  const data = toBinarySTL(geometry)
  const blob = new Blob([data], { type: 'model/stl' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Convert a BufferGeometry into a binary STL ArrayBuffer.
 * Uses non-indexed (triangle-list) vertex data.
 *
 * @param {THREE.BufferGeometry} geometry
 * @returns {ArrayBuffer}
 */
export function toBinarySTL(geometry) {
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  const positions = nonIndexed.attributes.position
  const normals = nonIndexed.attributes.normal

  const triCount = positions.count / 3
  // 80-byte header + 4-byte triangle count + 50 bytes per triangle
  const buffer = new ArrayBuffer(84 + triCount * 50)
  const view = new DataView(buffer)

  // Header (80 bytes, zero-filled)
  const header = 'NC7 Studio3D binary STL export'
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i))

  // Triangle count at offset 80
  view.setUint32(80, triCount, true)

  // Write triangles
  let offset = 84
  for (let i = 0; i < triCount; i++) {
    // Normal (12 bytes)
    writeVec3(view, offset, normals.getX(i * 3), normals.getY(i * 3), normals.getZ(i * 3))
    offset += 12

    // Three vertices (36 bytes)
    for (let j = 0; j < 3; j++) {
      writeVec3(view, offset, positions.getX(i * 3 + j), positions.getY(i * 3 + j), positions.getZ(i * 3 + j))
      offset += 12
    }

    // Attribute byte count (2 bytes, 0)
    view.setUint16(offset, 0, true)
    offset += 2
  }

  return buffer
}

function writeVec3(view, offset, x, y, z) {
  view.setFloat32(offset, x, true)
  view.setFloat32(offset + 4, y, true)
  view.setFloat32(offset + 8, z, true)
}

// STL loading utilities (ASCII + binary) using Three.js

import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

/**
 * Load an STL file (File object) into a THREE.BufferGeometry.
 * Supports both binary and ASCII STL via Three.js STLLoader.
 *
 * @param {File} file - The .stl File object from the file input
 * @returns {Promise<THREE.BufferGeometry>}
 */
export function loadSTLFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (event) => {
      try {
        const loader = new STLLoader()
        // STLLoader.parse accepts ArrayBuffer (binary) or String (ASCII)
        const geometry = loader.parse(event.target.result)
        geometry.computeVertexNormals()
        resolve(geometry)
      } catch (err) {
        reject(new Error(`Failed to parse STL: ${err.message}`))
      }
    }

    reader.onerror = () => reject(new Error('Failed to read file'))

    // Read as ArrayBuffer; STLLoader handles both binary and ASCII formats
    reader.readAsArrayBuffer(file)
  })
}

/**
 * Compute the bounding box of a BufferGeometry.
 *
 * @param {THREE.BufferGeometry} geometry
 * @returns {THREE.Box3}
 */
export function computeBoundingBox(geometry) {
  geometry.computeBoundingBox()
  return geometry.boundingBox
}

/**
 * Get the dimensions (size) of the bounding box in each axis.
 *
 * @param {THREE.Box3} box
 * @returns {{x: number, y: number, z: number}}
 */
export function getBoxSize(box) {
  const size = new THREE.Vector3()
  box.getSize(size)
  return { x: size.x, y: size.y, z: size.z }
}

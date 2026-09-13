// STL loading utilities (ASCII + binary) using Three.js

import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

/**
 * Load an STL file (File object) into a THREE.BufferGeometry.
 * Supports both binary and ASCII STL via Three.js STLLoader.
 *
 * @param {File} file - The .stl File object from the file input
 * @param {{ onReadProgress?: (loaded: number, total: number) => void, onStage?: (stage: string) => void }} [hooks]
 * @returns {Promise<THREE.BufferGeometry>}
 */
export function loadSTLFile(file, hooks = {}) {
  const { onReadProgress, onStage } = hooks
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    // Byte progress is only observable while reading; STLLoader.parse and
    // computeVertexNormals below are opaque synchronous loops with no hooks.
    reader.onprogress = (event) => {
      if (event.lengthComputable && onReadProgress) {
        onReadProgress(event.loaded, event.total)
      }
    }

    reader.onload = (event) => {
      try {
        onStage?.('Parsing mesh…')
        const loader = new STLLoader()
        // STLLoader.parse accepts ArrayBuffer (binary) or String (ASCII)
        const geometry = loader.parse(event.target.result)
        onStage?.('Computing normals…')
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
 * Load an STL file from a URL (useful for built-in demo files).
 *
 * @param {string} url
 * @returns {Promise<THREE.BufferGeometry>}
 */
export async function loadSTLFromUrl(url) {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch STL: ${res.status} ${res.statusText}`)
  }
  const buffer = await res.arrayBuffer()
  return loadSTLFromArrayBuffer(buffer)
}

/**
 * Parse an STL from an ArrayBuffer (binary or ASCII).
 *
 * @param {ArrayBuffer} buffer
 * @returns {THREE.BufferGeometry}
 */
export function loadSTLFromArrayBuffer(buffer) {
  const loader = new STLLoader()
  const geometry = loader.parse(buffer)
  geometry.computeVertexNormals()
  return geometry
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

// STL loading utilities (ASCII + binary) using Three.js

import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

/**
 * Orient a freshly-parsed STL so its height axis is +Y (app convention).
 *
 * Many STLs (modelled in a 3D app with the Z axis up) store the model standing
 * on the X-Y plane with height along Z. The app consumes Y-up geometry (world
 * Y = machine vertical, floor Y = 0, rotary axis along Y), so a Z-up mesh must
 * be rotated `-90°` about X to stand up. We auto-detect the up axis from the
 * bounding-box proportions rather than assuming, so Y-up files are left alone.
 *
 * Heuristic (robust vs symmetric/degenerate boxes):
 *   - Z clearly dominant (Z > 1.5·Y) → assume Z-up → rotateX(-π/2)
 *   - Y clearly dominant (Y > 1.5·Z) → assume Y-up → no change
 *   - otherwise ambiguous → default to Z-up (the common 3D-print convention)
 *
 * @param {THREE.BufferGeometry} geometry
 * @returns {THREE.BufferGeometry} the same geometry, oriented/mutated in place
 */
export function orientGeometryUp(geometry) {
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  if (!bb || bb.isEmpty()) return geometry

  const size = bb.getSize(new THREE.Vector3())
  const y = size.y
  const z = size.z

  const rotate = z > 1.5 * y
  if (rotate) {
    geometry.rotateX(-Math.PI / 2)
    geometry.computeBoundingBox()
  }
  return geometry
}

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
        orientGeometryUp(geometry)
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
  orientGeometryUp(geometry)
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

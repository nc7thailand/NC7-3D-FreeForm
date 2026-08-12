// Mesh simplification (decimation) to reduce triangle count / file size.

import * as THREE from 'three'

/**
 * Simplify a BufferGeometry by removing triangles according to a target
 * reduction ratio or an absolute target triangle count.
 *
 * NOTE: Full smart decimation (quadric error metrics) is complex. This module
 * provides a robust but simple decimation strategy. For high-quality results,
 * consider using the `meshoptimizer` library. The approach here performs
 * sequential plane-collapse simplification for reasonable previews.
 *
 * @param {THREE.BufferGeometry} geometry - input geometry (will NOT be mutated)
 * @param {object} options
 * @param {number} [options.ratio] - fraction of triangles to keep (0..1). e.g. 0.5
 * @param {number} [options.maxTriangles] - absolute target triangle count
 * @param {number} [options.minTriangles=100] - minimum triangles to avoid collapsing too far
 * @returns {{ geometry: THREE.BufferGeometry, originalTriangles: number, newTriangles: number }}
 */
export function simplifyGeometry(geometry, options = {}) {
  const originalTriangles = geometry.index
    ? geometry.index.count / 3
    : geometry.attributes.position.count / 3

  // Determine target triangle count
  let targetTriangles = originalTriangles
  const minTriangles = options.minTriangles ?? 100

  if (options.maxTriangles) {
    targetTriangles = Math.min(originalTriangles, Math.floor(options.maxTriangles))
  } else if (typeof options.ratio === 'number') {
    targetTriangles = Math.max(minTriangles, Math.floor(originalTriangles * options.ratio))
  }

  if (targetTriangles >= originalTriangles) {
    // Nothing to simplify
    return {
      geometry: geometry.clone(),
      originalTriangles,
      newTriangles: originalTriangles,
    }
  }

  // --- Simple decimation: mesh decimation via vertex clustering on a grid ---
  // A pragmatic grid-based simplification that produces predictable results.
  // Each vertex is snapped to a grid cell, and duplicate cells are merged.

  const gridDivisions = Math.floor(Math.cbrt(targetTriangles * 6)) // rough estimate
  const simplified = gridDecimate(geometry, Math.max(gridDivisions, 1))
  const newTriangles = simplified.index
    ? simplified.index.count / 3
    : simplified.attributes.position.count / 3

  return {
    geometry: simplified,
    originalTriangles,
    newTriangles: Math.floor(newTriangles),
  }
}

/**
 * Grid-based vertex clustering decimation.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {number} divisions
 * @returns {THREE.BufferGeometry}
 */
function gridDecimate(geometry, divisions) {
  const geometryIndexed = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  const pos = geometryIndexed.attributes.position
  geometryIndexed.computeBoundingBox()
  const box = geometryIndexed.boundingBox

  const min = new THREE.Vector3(box.min.x, box.min.y, box.min.z)
  const size = new THREE.Vector3()
  box.getSize(size)
  const cell = new THREE.Vector3(
    Math.max(size.x / divisions, 1e-6),
    Math.max(size.y / divisions, 1e-6),
    Math.max(size.z / divisions, 1e-6)
  )

  // Map vertex -> cluster representative
  const clusterMap = new Map()
  const newVerts = []
  const cellToIndex = new Map()

  for (let i = 0; i < pos.count; i++) {
    const key =
      Math.floor((pos.getX(i) - min.x) / cell.x) + ',' +
      Math.floor((pos.getY(i) - min.y) / cell.y) + ',' +
      Math.floor((pos.getZ(i) - min.z) / cell.z)

    if (!cellToIndex.has(key)) {
      cellToIndex.set(key, newVerts.length / 3)
      newVerts.push(pos.getX(i), pos.getY(i), pos.getZ(i))
    }
  }

  // Rebuild triangles, skipping degenerate ones
  const newIndices = []
  for (let i = 0; i < pos.count; i += 3) {
    const i0 = cellToIndex.get(
      cellKey(pos, i + 0, min, cell)
    )
    const i1 = cellToIndex.get(
      cellKey(pos, i + 1, min, cell)
    )
    const i2 = cellToIndex.get(
      cellKey(pos, i + 2, min, cell)
    )

    if (i0 === undefined || i1 === undefined || i2 === undefined) continue
    if (i0 === i1 || i1 === i2 || i0 === i2) continue // degenerate

    newIndices.push(i0, i1, i2)
  }

  const newGeometry = new THREE.BufferGeometry()
  newGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(newVerts), 3)
  )
  if (newIndices.length > 0) {
    newGeometry.setIndex(newIndices)
  }
  newGeometry.computeVertexNormals()
  newGeometry.computeBoundingBox()
  return newGeometry
}

/**
 * Get the clustering cell key for a given vertex index.
 */
function cellKey(pos, index, min, cell) {
  return (
    Math.floor((pos.getX(index) - min.x) / cell.x) + ',' +
    Math.floor((pos.getY(index) - min.y) / cell.y) + ',' +
    Math.floor((pos.getZ(index) - min.z) / cell.z)
  )
}

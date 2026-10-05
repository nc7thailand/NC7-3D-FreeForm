import * as THREE from 'three'
import { simplifyGeometry } from './simplify.js'
import { TARGET_WORKING_TRIANGLES } from './importLimit.js'

export function meshTriangleCount(geometry) {
  if (!geometry?.attributes?.position) return 0
  return geometry.index
    ? geometry.index.count / 3
    : geometry.attributes.position.count / 3
}

function clampToTriangleCap(geometry, maxTriangles) {
  const index = geometry.getIndex()
  if (index && index.count / 3 <= maxTriangles) return geometry
  if (!index && geometry.attributes.position.count / 3 <= maxTriangles) return geometry

  if (index) {
    const kept = index.array.slice(0, maxTriangles * 3)
    geometry.setIndex(new THREE.BufferAttribute(kept, 1))
    return geometry
  }

  const pos = geometry.attributes.position.array
  const kept = pos.slice(0, maxTriangles * 9)
  const next = new THREE.BufferGeometry()
  next.setAttribute('position', new THREE.BufferAttribute(kept, 3))
  next.computeVertexNormals()
  next.computeBoundingBox()
  geometry.dispose()
  return next
}

/**
 * Reduce dense meshes to the working triangle budget for toolpath stability.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {{ maxTriangles?: number, onProgress?: (done: number, total: number, stage?: string) => void|Promise<void> }} [options]
 */
export async function autoSimplifyMesh(geometry, options = {}) {
  const maxTriangles = options.maxTriangles ?? TARGET_WORKING_TRIANGLES
  const onProgress = options.onProgress
  const originalTriangles = meshTriangleCount(geometry)

  if (originalTriangles <= maxTriangles) {
    return {
      geometry,
      simplified: false,
      originalTriangles,
      newTriangles: originalTriangles,
    }
  }

  await onProgress?.(15, 100, 'Analyzing mesh density…')

  let target = maxTriangles
  let simplified = simplifyGeometry(geometry, { maxTriangles: target, minTriangles: 100 })

  for (let guard = 0; simplified.newTriangles > maxTriangles && guard < 8; guard++) {
    simplified.geometry.dispose()
    target = Math.max(100, Math.floor(target * (maxTriangles / Math.max(simplified.newTriangles, 1)) * 0.85))
    await onProgress?.(35 + guard * 8, 100, 'Simplifying triangles…')
    simplified = simplifyGeometry(geometry, { maxTriangles: target, minTriangles: 100 })
  }

  await onProgress?.(85, 100, 'Finalizing optimized mesh…')

  let nextGeo = simplified.newTriangles > maxTriangles
    ? clampToTriangleCap(simplified.geometry, maxTriangles)
    : simplified.geometry

  if (nextGeo !== simplified.geometry) {
    simplified.geometry.dispose()
  }

  nextGeo.userData = {
    ...geometry.userData,
    nc7AutoSimplified: true,
    nc7OriginalTriangles: originalTriangles,
    nc7SimplifiedTriangles: meshTriangleCount(nextGeo),
  }

  geometry.dispose()

  await onProgress?.(100, 100, 'Optimization complete')

  return {
    geometry: nextGeo,
    simplified: true,
    originalTriangles,
    newTriangles: meshTriangleCount(nextGeo),
  }
}

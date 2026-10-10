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

/** Slider floor for import “keep detail” (fraction of original triangles). */
export const IMPORT_KEEP_RATIO_MIN = 0.25

/** Default keep ratio when a mesh exceeds the working triangle budget. */
export function defaultImportKeepRatio(originalTriangles) {
  if (originalTriangles <= TARGET_WORKING_TRIANGLES) return 1
  return Math.min(1, TARGET_WORKING_TRIANGLES / originalTriangles)
}

/** Target triangle count from a “keep this much detail” ratio (0..1). */
export function targetTrianglesFromKeepRatio(originalTriangles, keepRatio) {
  const ratio = Math.min(1, Math.max(IMPORT_KEEP_RATIO_MIN, Number(keepRatio) || 1))
  return Math.max(100, Math.floor(originalTriangles * ratio))
}

/**
 * Reduce a mesh toward maxTriangles. Mutates/disposes the passed geometry when reduction runs.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {number} maxTriangles
 * @param {{ onProgress?: (done: number, total: number, stage?: string) => void|Promise<void>, originalTriangles?: number }} [options]
 */
async function reduceGeometryToMaxTriangles(geometry, maxTriangles, options = {}) {
  const onProgress = options.onProgress
  const originalTriangles = options.originalTriangles ?? meshTriangleCount(geometry)

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
    nc7ImportKeepRatio: options.keepRatio,
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

/**
 * Simplify for import preview/retry. Does not dispose sourceGeometry.
 *
 * @param {THREE.BufferGeometry} sourceGeometry
 * @param {{ keepRatio?: number, onProgress?: (done: number, total: number, stage?: string) => void|Promise<void> }} [options]
 */
export async function simplifyImportMesh(sourceGeometry, options = {}) {
  const originalTriangles = meshTriangleCount(sourceGeometry)
  const keepRatio = options.keepRatio ?? defaultImportKeepRatio(originalTriangles)
  const maxTriangles = targetTrianglesFromKeepRatio(originalTriangles, keepRatio)

  if (originalTriangles <= maxTriangles) {
    const geometry = sourceGeometry.clone()
    geometry.userData = { ...sourceGeometry.userData }
    return {
      geometry,
      simplified: false,
      originalTriangles,
      newTriangles: originalTriangles,
      keepRatio,
      targetTriangles: maxTriangles,
    }
  }

  const workGeo = sourceGeometry.clone()
  workGeo.userData = { ...sourceGeometry.userData }
  const result = await reduceGeometryToMaxTriangles(workGeo, maxTriangles, {
    onProgress: options.onProgress,
    originalTriangles,
    keepRatio,
  })
  return { ...result, keepRatio, targetTriangles: maxTriangles }
}

/**
 * Reduce dense meshes to the working triangle budget for toolpath stability.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {{ maxTriangles?: number, onProgress?: (done: number, total: number, stage?: string) => void|Promise<void> }} [options]
 */
export async function autoSimplifyMesh(geometry, options = {}) {
  const maxTriangles = options.maxTriangles ?? TARGET_WORKING_TRIANGLES
  const originalTriangles = meshTriangleCount(geometry)

  if (originalTriangles <= maxTriangles) {
    return {
      geometry,
      simplified: false,
      originalTriangles,
      newTriangles: originalTriangles,
    }
  }

  const keepRatio = maxTriangles / originalTriangles
  return reduceGeometryToMaxTriangles(geometry, maxTriangles, {
    onProgress: options.onProgress,
    originalTriangles,
    keepRatio,
  })
}

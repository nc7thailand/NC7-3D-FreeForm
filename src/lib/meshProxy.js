import * as THREE from 'three'
import { simplifyGeometry } from './simplify.js'

/** Target fraction of triangles kept for the Toolpath 3D display shell. */
export const TOOLPATH_PROXY_RATIO = 0.12

/** Hard cap so dense STLs stay responsive on field tablets. */
export const TOOLPATH_PROXY_MAX_TRIANGLES = 24_000

/**
 * Build a low-poly display proxy from hi-res geometry.
 * Used only for the Toolpath 3D mesh shell — compute and overlay stay on hi-res / cutJob.
 *
 * @param {import('three').BufferGeometry} hiResGeo
 * @param {{ ratio?: number, maxTriangles?: number }} [options]
 * @returns {import('three').BufferGeometry|null}
 */
export function triangleCount(geometry) {
  if (!geometry?.attributes?.position) return 0
  return geometry.index
    ? geometry.index.count / 3
    : geometry.attributes.position.count / 3
}

/**
 * Geometry the viewport should upload. Meshes already under the cap are
 * returned as-is so the GPU does not receive a second full copy.
 *
 * @param {import('three').BufferGeometry|null} hiResGeo
 * @returns {{ geometry: import('three').BufferGeometry|null, owned: boolean }}
 */
export function resolveToolpathDisplayGeometry(hiResGeo) {
  if (!hiResGeo) return { geometry: null, owned: false }
  if (triangleCount(hiResGeo) <= TOOLPATH_PROXY_MAX_TRIANGLES) {
    return { geometry: hiResGeo, owned: false }
  }
  const geometry = buildToolpathDisplayProxy(hiResGeo)
  hiResGeo.computeBoundingBox()
  if (hiResGeo.boundingBox) {
    geometry.userData.nc7PlacementBox = hiResGeo.boundingBox.clone()
  }
  return { geometry, owned: true }
}

export function buildToolpathDisplayProxy(hiResGeo, options = {}) {
  if (!hiResGeo) return null

  const maxTriangles = options.maxTriangles ?? TOOLPATH_PROXY_MAX_TRIANGLES
  const ratio = options.ratio ?? TOOLPATH_PROXY_RATIO
  let target = Math.min(
    triangleCount(hiResGeo),
    maxTriangles,
    Math.max(100, Math.floor(triangleCount(hiResGeo) * ratio)),
  )
  let simplified = simplifyGeometry(hiResGeo, { maxTriangles: target, minTriangles: 100 })
  // Grid clustering only approximates the target, so tighten the grid until
  // the shell is actually within the cap.
  for (let guard = 0; simplified.newTriangles > maxTriangles && guard < 8; guard++) {
    simplified.geometry.dispose()
    const scale = maxTriangles / Math.max(simplified.newTriangles, 1)
    target = Math.max(100, Math.floor(target * scale * 0.8))
    simplified = simplifyGeometry(hiResGeo, { maxTriangles: target, minTriangles: 100 })
  }

  const geometry = simplified.newTriangles > maxTriangles
    ? clampTriangles(simplified.geometry, maxTriangles)
    : simplified.geometry

  geometry.userData = {
    ...hiResGeo.userData,
    nc7DisplayProxy: true,
    nc7SourceUuid: hiResGeo.uuid,
    nc7ProxyTriangles: triangleCount(geometry),
    nc7SourceTriangles: simplified.originalTriangles,
  }

  return geometry
}

function clampTriangles(geometry, maxTriangles) {
  const index = geometry.getIndex()
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

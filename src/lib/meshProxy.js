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
export function buildToolpathDisplayProxy(hiResGeo, options = {}) {
  if (!hiResGeo) return null

  const { geometry, originalTriangles, newTriangles } = simplifyGeometry(hiResGeo, {
    ratio: options.ratio ?? TOOLPATH_PROXY_RATIO,
    maxTriangles: options.maxTriangles ?? TOOLPATH_PROXY_MAX_TRIANGLES,
    minTriangles: 100,
  })

  geometry.userData = {
    ...hiResGeo.userData,
    nc7DisplayProxy: true,
    nc7SourceUuid: hiResGeo.uuid,
    nc7ProxyTriangles: newTriangles,
    nc7SourceTriangles: originalTriangles,
  }

  return geometry
}

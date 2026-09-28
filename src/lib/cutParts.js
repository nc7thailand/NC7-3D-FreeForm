import * as THREE from 'three'

/**
 * @typedef {object} CutPart
 * @property {THREE.BufferGeometry} geometry
 * @property {THREE.Matrix4|null} [worldMatrix]
 * @property {boolean} [includeInCut=true]
 * @property {string} [role='artwork']
 * @property {string|null} [objectId]
 * @property {number} [placementRevision=0]
 */

/**
 * @param {THREE.BufferGeometry} geometry
 * @param {object} [opts]
 * @returns {CutPart}
 */
export function geometryToCutPart(geometry, {
  worldMatrix = null,
  includeInCut = true,
  role = 'artwork',
  objectId = null,
  placementRevision = 0,
} = {}) {
  return {
    geometry,
    worldMatrix,
    includeInCut,
    role,
    objectId: objectId ?? geometry?.uuid ?? null,
    placementRevision,
  }
}

/**
 * Accept a legacy single geometry or a parts array.
 *
 * @param {THREE.BufferGeometry|CutPart[]|null|undefined} partsOrGeometry
 * @returns {CutPart[]}
 */
export function normalizeCutParts(partsOrGeometry) {
  if (!partsOrGeometry) return []
  if (Array.isArray(partsOrGeometry)) {
    return partsOrGeometry.filter((p) => p?.geometry)
  }
  return [geometryToCutPart(partsOrGeometry)]
}

/** @param {CutPart[]} parts */
export function filterCutIncludedParts(parts) {
  return parts.filter((p) => p?.geometry && p.includeInCut !== false)
}

/**
 * Metadata stamped onto cutJob for staleness checks.
 *
 * @param {CutPart[]} parts
 */
export function cutPartsMetadata(parts) {
  const included = filterCutIncludedParts(parts)
  const primary = included.find((p) => p.role === 'artwork') ?? included[0] ?? null
  return {
    sourceObjectId: primary?.objectId ?? primary?.geometry?.uuid ?? null,
    sourcePlacementRevision: included.reduce(
      (max, p) => Math.max(max, p.placementRevision ?? 0),
      0,
    ),
    sourceGeometryUuid: primary?.geometry?.uuid ?? null,
    sourceModelRevision: primary?.geometry?.userData?.nc7ModelRevision ?? 0,
  }
}

/**
 * Axis-aligned world-space bbox of all cut-included parts.
 *
 * @param {CutPart[]} parts
 * @returns {THREE.Box3|null}
 */
export function combinedWorldBBox(parts) {
  const included = filterCutIncludedParts(parts)
  const box = new THREE.Box3()
  const corner = new THREE.Vector3()
  let hasAny = false

  for (const part of included) {
    const g = part.geometry
    g.computeBoundingBox()
    const bb = g.boundingBox
    if (!bb || bb.isEmpty()) continue

    const xs = [bb.min.x, bb.max.x]
    const ys = [bb.min.y, bb.max.y]
    const zs = [bb.min.z, bb.max.z]
    for (const x of xs) {
      for (const y of ys) {
        for (const z of zs) {
          corner.set(x, y, z)
          if (part.worldMatrix) corner.applyMatrix4(part.worldMatrix)
          box.expandByPoint(corner)
          hasAny = true
        }
      }
    }
  }

  return hasAny ? box : null
}

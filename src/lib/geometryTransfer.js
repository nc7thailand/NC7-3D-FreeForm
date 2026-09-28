import * as THREE from 'three'
import { normalizeCutParts } from './cutParts.js'

/**
 * Plain-object geometry payload for postMessage (optionally transferable).
 *
 * @param {THREE.BufferGeometry|null} geometry
 * @returns {{ payload: object|null, transferables: ArrayBuffer[] }}
 */
export function serializeGeometryForWorker(geometry) {
  if (!geometry) return { payload: null, transferables: [] }

  const posAttr = geometry.getAttribute('position')
  if (!posAttr) return { payload: null, transferables: [] }

  const position = new Float32Array(posAttr.array)
  const indexAttr = geometry.getIndex()
  const index = indexAttr ? new Uint32Array(indexAttr.array) : null
  const transferables = [position.buffer]
  if (index) transferables.push(index.buffer)

  return {
    payload: {
      uuid: geometry.uuid,
      userData: geometry.userData ? { ...geometry.userData } : {},
      position,
      index,
    },
    transferables,
  }
}

/** @param {object|null} payload */
export function deserializeGeometryFromWorker(payload) {
  if (!payload?.position?.length) return null

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(payload.position, 3))
  if (payload.index?.length) {
    geometry.setIndex(new THREE.BufferAttribute(payload.index, 1))
  }
  geometry.userData = payload.userData ? { ...payload.userData } : {}
  if (payload.uuid) geometry.uuid = payload.uuid
  geometry.computeBoundingBox()
  return geometry
}

/**
 * @param {import('./cutParts.js').CutPart[]} parts
 */
export function serializePartsForWorker(parts) {
  const payloads = []
  const transferables = []
  for (const part of normalizeCutParts(parts)) {
    const { payload, transferables: partTransferables } = serializeGeometryForWorker(part.geometry)
    if (!payload) continue
    payloads.push({
      geometry: payload,
      worldMatrix: part.worldMatrix ? Array.from(part.worldMatrix.elements) : null,
      includeInCut: part.includeInCut !== false,
      role: part.role ?? 'artwork',
      objectId: part.objectId ?? payload.uuid,
      placementRevision: part.placementRevision ?? 0,
    })
    transferables.push(...partTransferables)
  }
  return { parts: payloads, transferables }
}

/** @param {object[]|null|undefined} partsPayload */
export function deserializePartsFromWorker(partsPayload) {
  if (!partsPayload?.length) return []
  return partsPayload.map((part) => ({
    geometry: deserializeGeometryFromWorker(part.geometry),
    worldMatrix: part.worldMatrix?.length === 16
      ? new THREE.Matrix4().fromArray(part.worldMatrix)
      : null,
    includeInCut: part.includeInCut !== false,
    role: part.role ?? 'artwork',
    objectId: part.objectId ?? part.geometry?.uuid ?? null,
    placementRevision: part.placementRevision ?? 0,
  })).filter((part) => part.geometry)
}

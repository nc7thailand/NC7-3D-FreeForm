import * as THREE from 'three'

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

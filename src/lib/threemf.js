import * as THREE from 'three'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'
import { importSizeError } from './importLimit.js'
import { orientGeometryUp } from './stl.js'

/**
 * Load a .3mf file into one Y-up BufferGeometry.
 * Checked against the 5 MB limit before the file is read.
 *
 * @param {File} file
 * @param {{ onReadProgress?: (loaded: number, total: number) => void, onStage?: (stage: string) => void }} [hooks]
 * @returns {Promise<THREE.BufferGeometry>}
 */
export function load3MFFile(file, hooks = {}) {
  const tooLarge = importSizeError(file)
  if (tooLarge) return Promise.reject(new Error(tooLarge))

  const { onReadProgress, onStage } = hooks
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onprogress = (event) => {
      if (event.lengthComputable && onReadProgress) {
        onReadProgress(event.loaded, event.total)
      }
    }
    reader.onload = (event) => {
      try {
        onStage?.('Parsing 3MF…')
        resolve(parse3MFArrayBuffer(event.target.result))
      } catch (err) {
        reject(new Error(`Failed to parse 3MF: ${err.message}`))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsArrayBuffer(file)
  })
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {THREE.BufferGeometry}
 */
export function parse3MFArrayBuffer(buffer) {
  const loader = new ThreeMFLoader()
  const group = loader.parse(buffer)
  try {
    return geometryFrom3MFGroup(group)
  } finally {
    dispose3MFGroup(group)
  }
}

function geometryFrom3MFGroup(group) {
  group.updateMatrixWorld(true)
  const chunks = []
  let vertexCount = 0
  group.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position) return
    const baked = bakeMeshPositions(obj)
    chunks.push(baked)
    vertexCount += baked.length / 3
  })
  if (!vertexCount) throw new Error('3MF file has no mesh.')

  const positions = new Float32Array(vertexCount * 3)
  let offset = 0
  for (const chunk of chunks) {
    positions.set(chunk, offset)
    offset += chunk.length
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  orientGeometryUp(geometry)
  return geometry
}

function bakeMeshPositions(mesh) {
  const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry
  const pos = source.attributes.position
  const baked = new Float32Array(pos.count * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
    baked[i * 3] = v.x
    baked[i * 3 + 1] = v.y
    baked[i * 3 + 2] = v.z
  }
  if (source !== mesh.geometry) source.dispose()
  return baked
}

function dispose3MFGroup(group) {
  group.traverse((obj) => {
    obj.geometry?.dispose?.()
    const materials = obj.material
      ? (Array.isArray(obj.material) ? obj.material : [obj.material])
      : []
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value?.isTexture) value.dispose()
      }
      material.dispose?.()
    }
  })
}

import * as THREE from 'three'
import { zip, unzip } from 'fflate'
import { toBinarySTL } from './export.js'
import { loadSTLFromArrayBuffer } from './stl.js'
import { cutJobHasProfile } from './cutJob.js'
import { migrateOverlayContours } from './cutOverlay.js'

export const PROJECT_FORMAT = 'nc7studio3d-project'
export const PROJECT_VERSION = 1
export const PROJECT_EXTENSION = '.nc7project'

const MANIFEST_NAME = 'manifest.json'
const MODEL_NAME = 'model.stl'

function vec3ToJson(v) {
  return { x: v.x, y: v.y, z: v.z }
}

function jsonToVec3(o) {
  return new THREE.Vector3(o.x, o.y, o.z)
}

function serializeProfile(profile) {
  if (!profile) return null
  return {
    polylines: profile.polylines,
    pointCount: profile.pointCount,
    frame: {
      point: vec3ToJson(profile.frame.point),
      uAxis: vec3ToJson(profile.frame.uAxis),
      normal: vec3ToJson(profile.frame.normal),
    },
  }
}

function deserializeProfile(data) {
  if (!data) return null
  return {
    polylines: data.polylines,
    pointCount: data.pointCount,
    frame: {
      point: jsonToVec3(data.frame.point),
      uAxis: jsonToVec3(data.frame.uAxis),
      normal: jsonToVec3(data.frame.normal),
    },
  }
}

function serializeCutJob(cutJob) {
  if (!cutJob) return null
  return {
    rotationN: cutJob.rotationN,
    mode: cutJob.mode ?? null,
    sourceGeometryUuid: cutJob.sourceGeometryUuid ?? null,
    sourceModelRevision: cutJob.sourceModelRevision ?? null,
    stock: cutJob.stock ? { ...cutJob.stock } : null,
    overlayContourVersion: cutJob.overlayContourVersion ?? null,
    cuts: cutJob.cuts.map((cut) => ({
      index: cut.index,
      thetaDeg: cut.thetaDeg,
      profile: serializeProfile(cut.profile),
      overlayContour: cut.overlayContour ?? null,
    })),
  }
}

function deserializeCutJob(data) {
  if (!data) return null
  const cuts = data.cuts.map((cut) => ({
    index: cut.index,
    thetaDeg: cut.thetaDeg,
    profile: deserializeProfile(cut.profile),
    overlayContour: cut.overlayContour ?? null,
  }))
  return migrateOverlayContours({
    rotationN: data.rotationN,
    mode: data.mode ?? null,
    sourceGeometryUuid: data.sourceGeometryUuid ?? null,
    sourceModelRevision: data.sourceModelRevision ?? null,
    stock: data.stock ? { ...data.stock } : null,
    overlayContourVersion: data.overlayContourVersion ?? null,
    cuts,
  })
}

function buildManifest({ modelName, stock, rotationN, cutIndex, cutJob, gcodeSettings }) {
  const now = new Date().toISOString()
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    app: { minVersion: '0.1.0' },
    createdAt: now,
    modifiedAt: now,
    model: {
      file: MODEL_NAME,
      name: modelName || 'model.stl',
      units: 'mm',
    },
    stock: { ...stock },
    toolpath: {
      rotationN,
      cutIndex,
      cutJob: serializeCutJob(cutJob),
    },
    gcode: gcodeSettings ? { ...gcodeSettings } : null,
  }
}

function validateManifest(manifest) {
  if (!manifest || manifest.format !== PROJECT_FORMAT) {
    throw new Error('Not a valid NC7 Studio3D project file.')
  }
  if (!manifest.version || manifest.version > PROJECT_VERSION) {
    throw new Error(`Unsupported project version (${manifest.version ?? 'unknown'}).`)
  }
  if (!manifest.stock || typeof manifest.stock.w !== 'number') {
    throw new Error('Project file is missing foam block settings.')
  }
  if (!manifest.toolpath || typeof manifest.toolpath.rotationN !== 'number') {
    throw new Error('Project file is missing toolpath settings.')
  }
}

function zipToBlob(entries) {
  return new Promise((resolve, reject) => {
    zip(entries, (err, data) => {
      if (err) reject(err)
      else resolve(new Blob([data], { type: 'application/zip' }))
    })
  })
}

function unzipFromBuffer(buffer) {
  return new Promise((resolve, reject) => {
    unzip(new Uint8Array(buffer), (err, data) => {
      if (err) reject(err)
      else resolve(data)
    })
  })
}

/**
 * Pack geometry and CAM settings into a .nc7project blob.
 */
export async function packProject({ geometry, modelName, stock, rotationN, cutIndex, cutJob, gcodeSettings }) {
  if (!geometry) throw new Error('No model geometry to save.')

  const manifest = buildManifest({ modelName, stock, rotationN, cutIndex, cutJob, gcodeSettings })
  const stlBuffer = toBinarySTL(geometry)
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2))

  return zipToBlob({
    [MANIFEST_NAME]: manifestBytes,
    [MODEL_NAME]: new Uint8Array(stlBuffer),
  })
}

function unpackProjectEntries(entries) {
  const manifestBytes = entries[MANIFEST_NAME]
  const modelBytes = entries[MODEL_NAME]
  if (!manifestBytes) throw new Error('Project is missing manifest.json.')
  if (!modelBytes) throw new Error('Project is missing model.stl.')

  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes))
  validateManifest(manifest)

  const geometry = loadSTLFromArrayBuffer(modelBytes.buffer.slice(
    modelBytes.byteOffset,
    modelBytes.byteOffset + modelBytes.byteLength,
  ))
  geometry.userData.nc7CentroidApplied = true

  const cutJob = deserializeCutJob(manifest.toolpath.cutJob)
  const cutIndex = Math.min(
    Math.max(manifest.toolpath.cutIndex ?? 0, 0),
    Math.max(manifest.toolpath.rotationN - 1, 0),
  )

  return {
    manifest,
    geometry,
    modelName: manifest.model?.name || 'model.stl',
    stock: { ...manifest.stock },
    rotationN: manifest.toolpath.rotationN,
    cutIndex,
    cutJob,
    gcodeSettings: manifest.gcode ? { ...manifest.gcode } : null,
    hasToolpath: cutJobHasProfile(cutJob),
  }
}

/**
 * Unpack a .nc7project ArrayBuffer (browser session or file bytes).
 */
export async function unpackProjectBuffer(buffer) {
  const entries = await unzipFromBuffer(buffer)
  return unpackProjectEntries(entries)
}

/**
 * Unpack a .nc7project file into geometry and restored app state fields.
 */
export async function unpackProject(file) {
  const buffer = await readFileAsArrayBuffer(file)
  return unpackProjectBuffer(buffer)
}

export function downloadProjectBlob(blob, filename = `project${PROJECT_EXTENSION}`) {
  const safeName = filename.toLowerCase().endsWith(PROJECT_EXTENSION)
    ? filename
    : `${filename}${PROJECT_EXTENSION}`
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = safeName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function defaultProjectFilename(modelName) {
  const base = (modelName || 'project').replace(/\.stl$/i, '').replace(/\.nc7project$/i, '')
  return `${base}${PROJECT_EXTENSION}`
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Failed to read project file.'))
    reader.readAsArrayBuffer(file)
  })
}

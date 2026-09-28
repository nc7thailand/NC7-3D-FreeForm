// NC7 Studio3D 3MF project container (P5).
// Standard 3MF mesh XML + Metadata/nc7.json companion.

import * as THREE from 'three'
import { zip, unzip } from 'fflate'
import { cutJobHasProfile } from './cutJob.js'
import { migrateOverlayContours } from './cutOverlay.js'

export const THREEMF_EXTENSION = '.3mf'
export const NC7_METADATA_PATH = 'Metadata/nc7.json'
export const MODEL_PATH = '3D/3dmodel.model'

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
  <Default Extension="json" ContentType="application/json"/>
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`

function zipToBlob(entries) {
  return new Promise((resolve, reject) => {
    zip(entries, (err, data) => {
      if (err) reject(err)
      else resolve(new Blob([data], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' }))
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

function meshXmlForGeometry(geometry, objectId) {
  const g = geometry.index ? geometry.clone().toNonIndexed() : geometry.clone()
  const pos = g.attributes.position.array
  const vertLines = []
  for (let i = 0; i < pos.length; i += 3) {
    vertLines.push(`<vertex x="${pos[i]}" y="${pos[i + 1]}" z="${pos[i + 2]}"/>`)
  }
  const triLines = []
  const triCount = pos.length / 9
  for (let t = 0; t < triCount; t++) {
    const b = t * 3
    triLines.push(`<triangle v1="${b}" v2="${b + 1}" v3="${b + 2}"/>`)
  }
  g.dispose()
  return `<object id="${objectId}" type="model"><mesh><vertices>${vertLines.join('')}</vertices><triangles>${triLines.join('')}</triangles></mesh></object>`
}

function build3mfModelXml(sceneObjects) {
  const resourceObjects = sceneObjects.map((o, i) => meshXmlForGeometry(o.geometry, i + 1)).join('')
  const buildItems = sceneObjects.map((_, i) => `<item objectid="${i + 1}"/>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>${resourceObjects}</resources>
  <build>${buildItems}</build>
</model>`
}

function parse3mfMeshes(modelXml) {
  const meshes = []
  const objectBlocks = [...modelXml.matchAll(/<object id="(\d+)"[^>]*>[\s\S]*?<\/object>/g)]
  for (const block of objectBlocks) {
    const xml = block[0]
    const verts = [...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)]
      .map((m) => [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])])
    const tris = [...xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)]
    if (!verts.length || !tris.length) continue
    const positions = new Float32Array(tris.length * 9)
    let o = 0
    for (const m of tris) {
      for (const vi of [Number(m[1]), Number(m[2]), Number(m[3])]) {
        const v = verts[vi]
        positions[o++] = v[0]
        positions[o++] = v[1]
        positions[o++] = v[2]
      }
    }
    meshes.push({ meshIndex: Number(block[1]), positions })
  }
  return meshes
}

function positionsToGeometry(positions) {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  geo.computeBoundingBox()
  geo.userData.nc7CentroidApplied = true
  return geo
}

function serializeCutJob(cutJob) {
  if (!cutJob) return null
  return {
    rotationN: cutJob.rotationN,
    mode: cutJob.mode ?? null,
    sourceObjectId: cutJob.sourceObjectId ?? null,
    sourcePlacementRevision: cutJob.sourcePlacementRevision ?? null,
    sourceGeometryUuid: cutJob.sourceGeometryUuid ?? null,
    sourceModelRevision: cutJob.sourceModelRevision ?? null,
    stock: cutJob.stock ? { ...cutJob.stock } : null,
    overlayContourVersion: cutJob.overlayContourVersion ?? null,
    cuts: cutJob.cuts?.map((cut) => ({
      index: cut.index,
      thetaDeg: cut.thetaDeg,
      profile: cut.profile ? {
        polylines: cut.profile.polylines,
        pointCount: cut.profile.pointCount,
        frame: cut.profile.frame ? {
          point: { x: cut.profile.frame.point.x, y: cut.profile.frame.point.y, z: cut.profile.frame.point.z },
          uAxis: { x: cut.profile.frame.uAxis.x, y: cut.profile.frame.uAxis.y, z: cut.profile.frame.uAxis.z },
          normal: { x: cut.profile.frame.normal.x, y: cut.profile.frame.normal.y, z: cut.profile.frame.normal.z },
        } : null,
      } : null,
      overlayContour: cut.overlayContour ?? null,
    })) ?? [],
  }
}

function deserializeCutJob(data) {
  if (!data) return null
  const cuts = (data.cuts ?? []).map((cut) => ({
    index: cut.index,
    thetaDeg: cut.thetaDeg,
    profile: cut.profile ? {
      ...cut.profile,
      frame: cut.profile.frame ? {
        point: new THREE.Vector3(cut.profile.frame.point.x, cut.profile.frame.point.y, cut.profile.frame.point.z),
        uAxis: new THREE.Vector3(cut.profile.frame.uAxis.x, cut.profile.frame.uAxis.y, cut.profile.frame.uAxis.z),
        normal: new THREE.Vector3(cut.profile.frame.normal.x, cut.profile.frame.normal.y, cut.profile.frame.normal.z),
      } : null,
    } : null,
    overlayContour: cut.overlayContour ?? null,
  }))
  return migrateOverlayContours({
    rotationN: data.rotationN,
    mode: data.mode ?? null,
    sourceObjectId: data.sourceObjectId ?? null,
    sourcePlacementRevision: data.sourcePlacementRevision ?? null,
    sourceGeometryUuid: data.sourceGeometryUuid ?? null,
    sourceModelRevision: data.sourceModelRevision ?? null,
    stock: data.stock ? { ...data.stock } : null,
    overlayContourVersion: data.overlayContourVersion ?? null,
    cuts,
  })
}

function buildNc7Metadata({
  modelName,
  sceneObjects,
  selectedObjectId,
  toolpathObjectId,
  placementRevision,
  stock,
  rotationN,
  cutIndex,
  cutJob,
  gcodeSettings,
}) {
  return {
    format: 'nc7studio3d',
    version: 2,
    modelName: modelName ?? 'project',
    ui: {
      displayUnit: 'mm',
      selectedObjectId: selectedObjectId ?? null,
      toolpathObjectId: toolpathObjectId ?? null,
    },
    objects: sceneObjects.map((o, i) => ({
      id: o.id,
      name: o.name,
      color: o.color,
      type: o.type,
      parentId: o.parentId ?? null,
      includeInCut: o.includeInCut !== false,
      meshIndex: i + 1,
    })),
    placementRevision: placementRevision ?? 0,
    stock: { ...stock },
    toolpath: {
      objectId: toolpathObjectId ?? selectedObjectId ?? sceneObjects[0]?.id ?? null,
      rotationN,
      cutIndex,
      cutJob: serializeCutJob(cutJob),
    },
    gcode: gcodeSettings ? { ...gcodeSettings } : null,
  }
}

/**
 * Pack multi-object scene into a .3mf blob.
 *
 * @param {object} params
 */
export async function pack3mfProject({
  sceneObjects,
  modelName,
  selectedObjectId,
  toolpathObjectId,
  placementRevision,
  stock,
  rotationN,
  cutIndex,
  cutJob,
  gcodeSettings,
}) {
  if (!sceneObjects?.length) throw new Error('No scene objects to save.')

  const nc7 = buildNc7Metadata({
    modelName,
    sceneObjects,
    selectedObjectId,
    toolpathObjectId,
    placementRevision,
    stock,
    rotationN,
    cutIndex,
    cutJob,
    gcodeSettings,
  })

  const modelXml = build3mfModelXml(sceneObjects)
  return zipToBlob({
    '[Content_Types].xml': new TextEncoder().encode(CONTENT_TYPES),
    '_rels/.rels': new TextEncoder().encode(ROOT_RELS),
    [MODEL_PATH]: new TextEncoder().encode(modelXml),
    [NC7_METADATA_PATH]: new TextEncoder().encode(JSON.stringify(nc7, null, 2)),
  })
}

function restoreSceneObjects(meshes, metaObjects) {
  const byIndex = new Map(meshes.map((m) => [m.meshIndex, m]))
  return metaObjects.map((meta) => {
    const mesh = byIndex.get(meta.meshIndex)
    if (!mesh) return null
    return {
      id: meta.id,
      name: meta.name,
      type: meta.type ?? 'artwork',
      color: meta.color ?? '#3498db',
      parentId: meta.parentId ?? null,
      includeInCut: meta.includeInCut !== false,
      geometry: positionsToGeometry(mesh.positions),
    }
  }).filter(Boolean)
}

/**
 * Unpack .3mf project buffer.
 */
export async function unpack3mfProjectBuffer(buffer) {
  const entries = await unzipFromBuffer(buffer)
  const metaBytes = entries[NC7_METADATA_PATH]
  const modelBytes = entries[MODEL_PATH]
  if (!metaBytes) throw new Error('3MF is missing Metadata/nc7.json.')
  if (!modelBytes) throw new Error('3MF is missing 3D/3dmodel.model.')

  const nc7 = JSON.parse(new TextDecoder().decode(metaBytes))
  if (nc7.format !== 'nc7studio3d') throw new Error('Not a valid NC7 Studio3D 3MF file.')

  const modelXml = new TextDecoder().decode(modelBytes)
  const meshes = parse3mfMeshes(modelXml)
  const sceneObjects = restoreSceneObjects(meshes, nc7.objects ?? [])
  if (!sceneObjects.length) throw new Error('3MF contains no restorable meshes.')

  const cutJob = deserializeCutJob(nc7.toolpath?.cutJob)
  const cutIndex = Math.min(
    Math.max(nc7.toolpath?.cutIndex ?? 0, 0),
    Math.max((nc7.toolpath?.rotationN ?? 16) - 1, 0),
  )

  const primary = sceneObjects.find((o) => o.id === nc7.ui?.toolpathObjectId)
    ?? sceneObjects.find((o) => !o.parentId)
    ?? sceneObjects[0]

  return {
    format: '3mf',
    sceneObjects,
    geometry: primary.geometry,
    modelName: nc7.modelName ?? 'project.3mf',
    selectedObjectId: nc7.ui?.selectedObjectId ?? primary.id,
    toolpathObjectId: nc7.ui?.toolpathObjectId ?? nc7.toolpath?.objectId ?? primary.id,
    placementRevision: nc7.placementRevision ?? 0,
    stock: { ...nc7.stock },
    rotationN: nc7.toolpath?.rotationN ?? 16,
    cutIndex,
    cutJob,
    gcodeSettings: nc7.gcode ? { ...nc7.gcode } : null,
    hasToolpath: cutJobHasProfile(cutJob),
  }
}

export async function unpack3mfProject(file) {
  const buffer = await file.arrayBuffer()
  return unpack3mfProjectBuffer(buffer)
}

export function default3mfFilename(modelName) {
  const base = (modelName || 'project').replace(/\.(stl|3mf|nc7project)$/i, '')
  return `${base}${THREEMF_EXTENSION}`
}

export function download3mfBlob(blob, filename) {
  const safeName = filename.toLowerCase().endsWith(THREEMF_EXTENSION)
    ? filename
    : `${filename}${THREEMF_EXTENSION}`
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = safeName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function is3mfFile(file) {
  return file?.name?.toLowerCase().endsWith(THREEMF_EXTENSION)
}

import * as THREE from 'three'
import { buildCutJob } from './cutJob.js'
import { attachIndexSafetyToJob } from './indexSafety.js'
import { extractOverlayContour, OVERLAY_CONTOUR_VERSION } from './cutOverlay.js'
import { generateGcode } from './gcode.js'
import { planePointFromStock, silhouetteOptsFromStock } from './toolpath.js'
import { cutPartsMetadata, normalizeCutParts } from './cutParts.js'
import { deserializeGeometryFromWorker, deserializePartsFromWorker } from './geometryTransfer.js'

/**
 * Build a full cut job from geometry (hi-res mesh).
 *
 * @param {THREE.BufferGeometry|import('./cutParts.js').CutPart[]} partsOrGeometry
 * @param {object} params
 * @param {(done: number, total: number) => void|Promise<void>} [params.onProgress]
 */
export async function runToolpathPipeline(partsOrGeometry, {
  rotationN,
  stock,
  cutMode,
  planePoint: planePointInput,
  onProgress,
}) {
  const parts = normalizeCutParts(partsOrGeometry)
  if (!parts.length) return null

  const planePoint = planePointInput instanceof THREE.Vector3
    ? planePointInput
    : new THREE.Vector3(...(planePointInput ?? [0, 0, 0]))

  const job = await buildCutJob(parts, rotationN, planePoint, {
    silhouetteOpts: silhouetteOptsFromStock(stock),
    mode: cutMode,
    onProgress,
  })

  const meta = cutPartsMetadata(parts)
  job.stock = { ...stock }
  job.mode = cutMode
  job.sourceObjectId = meta.sourceObjectId
  job.sourcePlacementRevision = meta.sourcePlacementRevision
  job.sourceGeometryUuid = meta.sourceGeometryUuid
  job.sourceModelRevision = meta.sourceModelRevision

  for (const cut of job.cuts) {
    cut.overlayContour = extractOverlayContour(parts, cut.thetaDeg)
  }
  job.overlayContourVersion = OVERLAY_CONTOUR_VERSION

  attachIndexSafetyToJob(job, parts, stock, cutMode)
  return job
}

/**
 * @param {object} cutJob
 * @param {object} gcodeSettings
 * @param {{ geometry?: THREE.BufferGeometry|null }} [options]
 */
export function runGcodePipeline(cutJob, gcodeSettings, options = {}) {
  return generateGcode(cutJob, gcodeSettings, options)
}

/**
 * Worker entry — rebuild geometry from serialized payload then run toolpath.
 *
 * @param {object} payload
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function runToolpathPipelineFromPayload(payload, onProgress) {
  const parts = payload.parts?.length
    ? deserializePartsFromWorker(payload.parts)
    : normalizeCutParts(deserializeGeometryFromWorker(payload.geometry))
  if (!parts.length) return null

  const planePoint = payload.planePoint ?? planePointFromStock(payload.stock)
  const pp = Array.isArray(planePoint)
    ? new THREE.Vector3(planePoint[0], planePoint[1], planePoint[2])
    : new THREE.Vector3(planePoint.x, planePoint.y, planePoint.z)

  return runToolpathPipeline(parts, {
    rotationN: payload.rotationN,
    stock: payload.stock,
    cutMode: payload.cutMode,
    planePoint: pp,
    onProgress,
  })
}

export function runGcodePipelineFromPayload(payload) {
  return runGcodePipeline(payload.cutJob, payload.gcodeSettings, {
    geometry: payload.geometry ? deserializeGeometryFromWorker(payload.geometry) : null,
  })
}

import * as THREE from 'three'
import { buildCutJob } from './cutJob.js'
import { attachIndexSafetyToJob } from './indexSafety.js'
import { extractOverlayContour, OVERLAY_CONTOUR_VERSION } from './cutOverlay.js'
import { generateGcode } from './gcode.js'
import { geometryForToolpathSlicing, planePointFromStock, silhouetteOptsFromStock } from './toolpath.js'
import { deserializeGeometryFromWorker } from './geometryTransfer.js'

/**
 * Build a full cut job from geometry (hi-res mesh).
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {object} params
 * @param {(done: number, total: number) => void|Promise<void>} [params.onProgress]
 */
export async function runToolpathPipeline(geometry, {
  rotationN,
  stock,
  cutMode,
  planePoint: planePointInput,
  onProgress,
  adoptSlice = false,
}) {
  if (!geometry) return null

  const planePoint = planePointInput instanceof THREE.Vector3
    ? planePointInput
    : new THREE.Vector3(...(planePointInput ?? [0, 0, 0]))

  // One position buffer for every angle. The worker path adopts the buffer
  // it already received; the main-thread path copies positions once.
  const sliceGeo = geometryForToolpathSlicing(geometry, null, { adopt: adoptSlice })
  const rasterScratch = { grid: null }
  try {
    const job = await buildCutJob(sliceGeo, rotationN, planePoint, {
      silhouetteOpts: silhouetteOptsFromStock(stock),
      mode: cutMode,
      onProgress,
      prepared: true,
      rasterScratch,
    })

    job.stock = { ...stock }
    job.mode = cutMode
    job.sourceGeometryUuid = geometry.uuid
    job.sourceModelRevision = geometry.userData?.nc7ModelRevision ?? 0

    for (const cut of job.cuts) {
      cut.overlayContour = extractOverlayContour(sliceGeo, cut.thetaDeg, { rasterScratch })
    }
    job.overlayContourVersion = OVERLAY_CONTOUR_VERSION

    attachIndexSafetyToJob(job, sliceGeo, stock, cutMode)
    return job
  } finally {
    sliceGeo?.dispose()
  }
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
  const geometry = deserializeGeometryFromWorker(payload.geometry)
  if (!geometry) return null

  const planePoint = payload.planePoint ?? planePointFromStock(payload.stock)
  const pp = Array.isArray(planePoint)
    ? new THREE.Vector3(planePoint[0], planePoint[1], planePoint[2])
    : new THREE.Vector3(planePoint.x, planePoint.y, planePoint.z)

  return runToolpathPipeline(geometry, {
    rotationN: payload.rotationN,
    stock: payload.stock,
    cutMode: payload.cutMode,
    planePoint: pp,
    onProgress,
    adoptSlice: true,
  })
}

export function runGcodePipelineFromPayload(payload) {
  return runGcodePipeline(payload.cutJob, payload.gcodeSettings, {
    geometry: payload.geometry ? deserializeGeometryFromWorker(payload.geometry) : null,
  })
}

import { normalizeCutParts } from './cutParts.js'
import { serializeGeometryForWorker, serializePartsForWorker } from './geometryTransfer.js'
import {
  runGcodePipeline,
  runGcodePipelineFromPayload,
  runToolpathPipeline,
  runToolpathPipelineFromPayload,
} from './camPipeline.js'
import { planePointFromStock } from './toolpath.js'

let worker = null
let requestId = 0
/** @type {Map<number, { resolve: Function, reject: Function, onProgress?: Function }>} */
const pending = new Map()

function supportsWorkers() {
  return typeof Worker !== 'undefined'
}

function getWorker() {
  if (!supportsWorkers()) return null
  if (!worker) {
    worker = new Worker(new URL('../workers/camWorker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (event) => {
      const msg = event.data ?? {}
      const { id, type } = msg
      const entry = pending.get(id)
      if (!entry) return

      if (type === 'progress') {
        entry.onProgress?.(msg.done, msg.total)
        return
      }

      pending.delete(id)
      if (msg.status === 'success') {
        entry.resolve(msg)
      } else {
        entry.reject(new Error(msg.error ?? 'CAM worker failed'))
      }
    }
    worker.onerror = (err) => {
      for (const [, entry] of pending) entry.reject(err.error ?? err)
      pending.clear()
    }
  }
  return worker
}

function post(action, payload, { onProgress, transferables = [] } = {}) {
  const w = getWorker()
  if (!w) {
    return runOnMainThread(action, payload, onProgress)
  }

  const id = ++requestId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress })
    w.postMessage({ id, action, payload }, transferables)
  })
}

async function runOnMainThread(action, payload, onProgress) {
  if (action === 'computeToolpath') {
    const cutJob = await runToolpathPipelineFromPayload(payload, onProgress)
    return { status: 'success', cutJob }
  }
  if (action === 'compileGcode') {
    const gcodeResult = runGcodePipelineFromPayload(payload)
    return { status: 'success', gcodeResult }
  }
  throw new Error(`Unknown action: ${action}`)
}

/**
 * @param {THREE.BufferGeometry|import('./cutParts.js').CutPart[]} partsOrGeometry
 * @param {object} params
 * @param {(done: number, total: number) => void} [params.onProgress]
 */
export function computeToolpathInWorker(partsOrGeometry, {
  rotationN,
  stock,
  cutMode,
  onProgress,
}) {
  const parts = normalizeCutParts(partsOrGeometry)
  const { parts: partsPayload, transferables } = serializePartsForWorker(parts)
  const pp = planePointFromStock(stock)

  return post('computeToolpath', {
    parts: partsPayload,
    rotationN,
    stock,
    cutMode,
    planePoint: [pp.x, pp.y, pp.z],
  }, { onProgress, transferables }).then((msg) => msg.cutJob)
}

/** Main-thread fallback for tests and worker-less environments. */
export async function computeToolpathOnMainThread(partsOrGeometry, params) {
  const pp = planePointFromStock(params.stock)
  return runToolpathPipeline(partsOrGeometry, {
    rotationN: params.rotationN,
    stock: params.stock,
    cutMode: params.cutMode,
    planePoint: pp,
    onProgress: params.onProgress,
  })
}

/**
 * @param {object} cutJob
 * @param {object} gcodeSettings
 * @param {THREE.BufferGeometry|null} [geometry]
 */
export function compileGcodeInWorker(cutJob, gcodeSettings, geometry = null) {
  const { payload: geometryPayload, transferables } = serializeGeometryForWorker(geometry)
  return post('compileGcode', {
    cutJob,
    gcodeSettings,
    geometry: geometryPayload,
  }, { transferables }).then((msg) => msg.gcodeResult)
}

export function compileGcodeOnMainThread(cutJob, gcodeSettings, geometry = null) {
  return runGcodePipeline(cutJob, gcodeSettings, { geometry })
}

export function terminateCamWorker() {
  for (const [, entry] of pending) {
    entry.reject(new Error('CAM worker terminated'))
  }
  pending.clear()
  if (worker) {
    worker.terminate()
    worker = null
  }
}

import { serializeGeometryForWorker } from './geometryTransfer.js'
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
 * @param {THREE.BufferGeometry} geometry
 * @param {object} params
 * @param {(done: number, total: number) => void} [params.onProgress]
 */
export function computeToolpathInWorker(geometry, {
  rotationN,
  stock,
  cutMode,
  onProgress,
}) {
  const { payload: geometryPayload, transferables } = serializeGeometryForWorker(geometry)
  const pp = planePointFromStock(stock)

  return post('computeToolpath', {
    geometry: geometryPayload,
    rotationN,
    stock,
    cutMode,
    planePoint: [pp.x, pp.y, pp.z],
  }, { onProgress, transferables }).then((msg) => msg.cutJob)
}

/** Main-thread fallback for tests and worker-less environments. */
export async function computeToolpathOnMainThread(geometry, params) {
  const pp = planePointFromStock(params.stock)
  return runToolpathPipeline(geometry, {
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
  const { payload: geometryPayload } = serializeGeometryForWorker(geometry)
  return post('compileGcode', {
    cutJob,
    gcodeSettings,
    geometry: geometryPayload,
  }).then((msg) => msg.gcodeResult)
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

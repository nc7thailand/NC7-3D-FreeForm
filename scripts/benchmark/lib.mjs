import { execSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'

/** @returns {number} */
export function triangleCount(geometry) {
  if (!geometry?.attributes?.position) return 0
  return geometry.index
    ? geometry.index.count / 3
    : geometry.attributes.position.count / 3
}

export function byteCount(geometry) {
  if (!geometry?.attributes?.position) return 0
  const pos = geometry.attributes.position.array?.byteLength ?? 0
  const idx = geometry.getIndex()?.array?.byteLength ?? 0
  const norm = geometry.attributes.normal?.array?.byteLength ?? 0
  return { position: pos, index: idx, normal: norm, total: pos + idx + norm }
}

export function gitMeta() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim()
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
    return { branch, commit }
  } catch {
    return { branch: 'unknown', commit: 'unknown' }
  }
}

/**
 * Tracks peak heap during async work. Node uses process.memoryUsage(); the
 * browser harness swaps in performance.memory when available.
 *
 * @param {{ heapUsed?: () => number|null }} [hooks]
 */
export function createMemoryTracker(hooks = {}) {
  const readHeap = hooks.heapUsed ?? (() => process.memoryUsage().heapUsed)
  const marks = {}
  let peak = readHeap() ?? 0
  let peakMark = 'start'

  return {
    mark(name) {
      const heap = readHeap()
      if (heap == null) return heap
      marks[name] = heap
      if (heap > peak) {
        peak = heap
        peakMark = name
      }
      return heap
    },
    sample(name) {
      return this.mark(name)
    },
    report() {
      return {
        marks,
        peakBytes: peak,
        peakMark,
        peakMiB: roundMiB(peak),
      }
    },
  }
}

export function roundMs(value) {
  return Math.round(value * 100) / 100
}

export function roundMiB(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100
}

export function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${roundMiB(bytes)} MiB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`
  return `${bytes} B`
}

/**
 * Count BufferGeometry.clone() calls during a callback.
 * @param {() => Promise<T>|T} fn
 * @returns {Promise<{ result: T, cloneCount: number }>}
 */
export async function withCloneCounter(fn) {
  const THREE = await import('three')
  let cloneCount = 0
  const original = THREE.BufferGeometry.prototype.clone
  THREE.BufferGeometry.prototype.clone = function cloneCounted() {
    cloneCount += 1
    return original.call(this)
  }
  try {
    const result = await fn()
    return { result, cloneCount }
  } finally {
    THREE.BufferGeometry.prototype.clone = original
  }
}

/** True when the checked-out camPipeline shares one slice buffer (feature branch). */
export function pipelineUsesSharedSlice(runToolpathPipeline) {
  const src = runToolpathPipeline.toString()
  return src.includes('sliceGeo') && src.includes('prepared: true')
}

/**
 * Phase-timed toolpath run mirroring the current branch's camPipeline.js.
 */
export async function runPhasedToolpath({
  geometry,
  rotationN,
  stock,
  cutMode,
  planePoint,
  buildCutJob,
  extractOverlayContour,
  attachIndexSafetyToJob,
  geometryForToolpathSlicing,
  silhouetteOptsFromStock,
  OVERLAY_CONTOUR_VERSION,
  runToolpathPipeline,
  onProgress,
}) {
  const memory = createMemoryTracker()
  const timingsMs = {}
  memory.mark('heapBefore')

  if (pipelineUsesSharedSlice(runToolpathPipeline)) {
    const sliceGeo = geometryForToolpathSlicing(geometry, null, { adopt: false })
    const rasterScratch = { grid: null }
    memory.mark('afterSlicePrep')
    try {
      const tProfile0 = performance.now()
      const job = await buildCutJob(sliceGeo, rotationN, planePoint, {
        silhouetteOpts: silhouetteOptsFromStock(stock),
        mode: cutMode,
        onProgress: (done, total) => {
          memory.mark(`profile_${done}/${total}`)
          onProgress?.('profile', done, total)
        },
        prepared: true,
        rasterScratch,
      })
      timingsMs.profilePhase = roundMs(performance.now() - tProfile0)
      memory.mark('afterProfile')

      const tOverlay0 = performance.now()
      for (const cut of job.cuts) {
        cut.overlayContour = extractOverlayContour(sliceGeo, cut.thetaDeg, { rasterScratch })
        memory.mark(`overlay_${cut.index}`)
      }
      timingsMs.overlayPhase = roundMs(performance.now() - tOverlay0)
      memory.mark('afterOverlay')

      job.overlayContourVersion = OVERLAY_CONTOUR_VERSION

      const tIndex0 = performance.now()
      attachIndexSafetyToJob(job, sliceGeo, stock, cutMode)
      timingsMs.indexSafetyPhase = roundMs(performance.now() - tIndex0)
      memory.mark('afterIndexSafety')

      job.stock = { ...stock }
      job.mode = cutMode
      job.sourceGeometryUuid = geometry.uuid
      job.sourceModelRevision = geometry.userData?.nc7ModelRevision ?? 0

      return { job, timingsMs, memory: memory.report() }
    } finally {
      sliceGeo?.dispose()
      memory.mark('heapAfter')
    }
  }

  memory.mark('afterSlicePrep')
  const tProfile0 = performance.now()
  const job = await buildCutJob(geometry, rotationN, planePoint, {
    silhouetteOpts: silhouetteOptsFromStock(stock),
    mode: cutMode,
    onProgress: (done, total) => {
      memory.mark(`profile_${done}/${total}`)
      onProgress?.('profile', done, total)
    },
  })
  timingsMs.profilePhase = roundMs(performance.now() - tProfile0)
  memory.mark('afterProfile')

  const tOverlay0 = performance.now()
  for (const cut of job.cuts) {
    cut.overlayContour = extractOverlayContour(geometry, cut.thetaDeg)
    memory.mark(`overlay_${cut.index}`)
  }
  timingsMs.overlayPhase = roundMs(performance.now() - tOverlay0)
  memory.mark('afterOverlay')

  job.overlayContourVersion = OVERLAY_CONTOUR_VERSION

  const tIndex0 = performance.now()
  attachIndexSafetyToJob(job, geometry, stock, cutMode)
  timingsMs.indexSafetyPhase = roundMs(performance.now() - tIndex0)
  memory.mark('afterIndexSafety')

  job.stock = { ...stock }
  job.mode = cutMode
  job.sourceGeometryUuid = geometry.uuid
  job.sourceModelRevision = geometry.userData?.nc7ModelRevision ?? 0
  memory.mark('heapAfter')

  return { job, timingsMs, memory: memory.report() }
}

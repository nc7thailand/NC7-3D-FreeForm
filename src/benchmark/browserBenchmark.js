/**
 * Browser benchmark — open http://localhost:5173/benchmark.html while dev is
 * running. Uses performance.memory (Chrome) when available.
 */

import * as THREE from 'three'
import { loadSTLFromUrl } from '../lib/stl.js'
import { CUT_MODE_LEFT_ONLY } from '../lib/cutJob.js'
import { buildCutJob } from '../lib/cutJob.js'
import { runToolpathPipeline } from '../lib/camPipeline.js'
import { extractOverlayContour, OVERLAY_CONTOUR_VERSION } from '../lib/cutOverlay.js'
import { attachIndexSafetyToJob } from '../lib/indexSafety.js'
import { planePointFromStock, silhouetteOptsFromStock, geometryForToolpathSlicing } from '../lib/toolpath.js'
import { DUMMY_STL_URL } from '../lib/exampleStl.js'
import {
  createMemoryTracker,
  pipelineUsesSharedSlice,
  roundMs,
  runPhasedToolpath,
  triangleCount,
  withCloneCounter,
} from '../../scripts/benchmark/lib.mjs'

const STOCK = {
  w: 400,
  t: 400,
  h: 650,
  lo: 5,
  bo: 1,
  kerf: 2,
  topOffset: 20,
  boAuto: true,
  boMargin: 20,
  profileAccuracy: 10,
}

const ROTATION_N = 16
const logEl = document.getElementById('log')
const outEl = document.getElementById('json')

function log(line) {
  logEl.textContent += `${line}\n`
}

function browserHeapUsed() {
  const mem = performance.memory
  if (!mem) return null
  return mem.usedJSHeapSize
}

function browserHeapSnapshot() {
  const mem = performance.memory
  if (!mem) return null
  return {
    usedJSHeapSize: mem.usedJSHeapSize,
    totalJSHeapSize: mem.totalJSHeapSize,
    jsHeapSizeLimit: mem.jsHeapSizeLimit,
  }
}

async function run() {
  logEl.textContent = ''
  outEl.textContent = ''
  log('Loading Knight STL…')

  const tLoad0 = performance.now()
  const geometry = await loadSTLFromUrl(DUMMY_STL_URL)
  const loadMs = roundMs(performance.now() - tLoad0)
  log(`Loaded ${triangleCount(geometry).toLocaleString()} triangles in ${loadMs} ms`)

  if (!performance.memory) {
    log('performance.memory unavailable — use Chrome or enable precise memory info.')
  }

  const planePoint = planePointFromStock(STOCK)
  const pipelineMemory = createMemoryTracker({ heapUsed: browserHeapUsed })

  const { result: pipelinePack, cloneCount } = await withCloneCounter(async () => {
    pipelineMemory.mark('heapBefore')
    const t0 = performance.now()
    const job = await runToolpathPipeline(geometry, {
      rotationN: ROTATION_N,
      stock: STOCK,
      cutMode: CUT_MODE_LEFT_ONLY,
      planePoint,
      onProgress: (done, total) => pipelineMemory.mark(`pipeline_${done}/${total}`),
    })
    pipelineMemory.mark('heapAfter')
    return { job, totalMs: roundMs(performance.now() - t0) }
  })

  const phased = await runPhasedToolpath({
    geometry,
    rotationN: ROTATION_N,
    stock: STOCK,
    cutMode: CUT_MODE_LEFT_ONLY,
    planePoint,
    buildCutJob,
    extractOverlayContour,
    attachIndexSafetyToJob,
    geometryForToolpathSlicing,
    silhouetteOptsFromStock,
    OVERLAY_CONTOUR_VERSION,
    runToolpathPipeline,
    onProgress: (_, done) => {
      if (browserHeapUsed()) pipelineMemory.mark(`browser_profile_${done}`)
    },
  })

  const report = {
    meta: {
      runner: 'browser',
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      performanceMemory: browserHeapSnapshot(),
    },
    mesh: {
      triangles: triangleCount(geometry),
      loadMs,
    },
    toolpath: {
      rotationN: ROTATION_N,
      cutCount: pipelinePack.job.cuts.length,
      pipelineMode: pipelineUsesSharedSlice(runToolpathPipeline) ? 'shared-slice' : 'per-angle-clone',
      cloneCountDuringPipeline: cloneCount,
      timingsMs: {
        loadStl: loadMs,
        totalPipeline: pipelinePack.totalMs,
        ...phased.timingsMs,
      },
      memoryBytes: {
        pipeline: pipelineMemory.report(),
        phased: phased.memory,
      },
    },
  }

  log('')
  log(`Pipeline: ${report.toolpath.timingsMs.totalPipeline} ms (${report.toolpath.pipelineMode})`)
  log(`Profile phase: ${report.toolpath.timingsMs.profilePhase} ms`)
  log(`Overlay phase: ${report.toolpath.timingsMs.overlayPhase} ms`)
  log(`Clones: ${cloneCount}`)
  if (report.toolpath.memoryBytes.phased.peakBytes) {
    log(`Peak heap (phased): ${report.toolpath.memoryBytes.phased.peakMiB} MiB at "${report.toolpath.memoryBytes.phased.peakMark}"`)
  }
  log('')
  log('Copy JSON below for compare-benchmarks (save as .json file).')

  outEl.textContent = JSON.stringify(report, null, 2)
  geometry.dispose()
}

document.getElementById('run')?.addEventListener('click', () => {
  run().catch((err) => {
    log(`Error: ${err.message}`)
    console.error(err)
  })
})

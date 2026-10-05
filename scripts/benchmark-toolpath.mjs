#!/usr/bin/env node
/**
 * NC7 toolpath A/B benchmark — run on each branch, then compare.
 *
 *   node scripts/benchmark-toolpath.mjs --out .benchmark/main.json
 *   git checkout feature/memory-optimization
 *   node scripts/benchmark-toolpath.mjs --out .benchmark/feature.json
 *   node scripts/compare-benchmarks.mjs .benchmark/main.json .benchmark/feature.json
 *
 * Node reports process.memoryUsage().heapUsed (Chrome performance.memory is
 * available in benchmark.html while npm run dev is up).
 */

import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import * as THREE from 'three'
import { loadSTLFromArrayBuffer } from '../src/lib/stl.js'
import { CUT_MODE_LEFT_ONLY } from '../src/lib/cutJob.js'
import { buildCutJob } from '../src/lib/cutJob.js'
import { runToolpathPipeline } from '../src/lib/camPipeline.js'
import { extractOverlayContour, OVERLAY_CONTOUR_VERSION } from '../src/lib/cutOverlay.js'
import { attachIndexSafetyToJob } from '../src/lib/indexSafety.js'
import { geometryForToolpathSlicing, planePointFromStock, silhouetteOptsFromStock } from '../src/lib/toolpath.js'
import {
  byteCount,
  createMemoryTracker,
  gitMeta,
  pipelineUsesSharedSlice,
  roundMs,
  runPhasedToolpath,
  triangleCount,
  withCloneCounter,
} from './benchmark/lib.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const DEFAULT_MESH = path.join(ROOT, 'Example/KnightChessNoHair.stl')
const DEFAULT_ROTATION_N = 16

const DEFAULT_STOCK = {
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

function parseArgs(argv) {
  const args = {
    out: null,
    mesh: DEFAULT_MESH,
    rotationN: DEFAULT_ROTATION_N,
    quick: false,
    jsonOnly: false,
  }
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--out' || arg === '-o') args.out = argv[++i]
    else if (arg === '--mesh') args.mesh = path.resolve(argv[++i])
    else if (arg === '--rotation-n') args.rotationN = Number(argv[++i])
    else if (arg === '--quick') args.quick = true
    else if (arg === '--json-only') args.jsonOnly = true
    else if (arg === '--help' || arg === '-h') args.help = true
  }
  return args
}

function printHelp() {
  console.log(`Usage: node scripts/benchmark-toolpath.mjs [options]

Options:
  --out, -o <file>     Write JSON report (default: stdout pretty JSON)
  --mesh <path>        STL input (default: Example/KnightChessNoHair.stl)
  --rotation-n <n>     Cut count driver N (default: 16)
  --quick              Use a synthetic dense mesh instead of Knight STL
  --json-only          Suppress human summary (JSON only)
`)
}

async function loadOptionalFeatureChecks() {
  const out = {
    importLimit: { available: false },
    displayProxy: { available: false },
  }

  try {
    const { importSizeError, MAX_IMPORT_BYTES, meshImportKind } = await import('../src/lib/importLimit.js')
    out.importLimit = {
      available: true,
      maxBytes: MAX_IMPORT_BYTES,
      maxMiB: MAX_IMPORT_BYTES / (1024 * 1024),
      acceptsExactLimit: importSizeError({ name: 'ok.stl', size: MAX_IMPORT_BYTES }) === null,
      rejectsOverLimit: typeof importSizeError({ name: 'big.stl', size: MAX_IMPORT_BYTES + 1 }) === 'string',
      stlKind: meshImportKind('part.stl') === 'stl',
      threemfKind: meshImportKind('part.3mf') === '3mf',
    }
  } catch {
    out.importLimit.note = 'importLimit.js not on this branch'
  }

  try {
    const proxy = await import('../src/lib/meshProxy.js')
    const cap = proxy.TOOLPATH_PROXY_MAX_TRIANGLES ?? 24_000
    const resolver = proxy.resolveToolpathDisplayGeometry ?? ((geo) => ({
      geometry: proxy.buildToolpathDisplayProxy?.(geo) ?? geo,
      owned: true,
    }))
    const densePositions = new Float32Array(30_000 * 9)
    for (let i = 0; i < densePositions.length; i++) densePositions[i] = (i % 97) * 0.05
    const dense = new THREE.BufferGeometry()
    dense.setAttribute('position', new THREE.BufferAttribute(densePositions, 3))
    const inputTriangles = triangleCount(dense)
    const { geometry: shell, owned } = resolver(dense)
    const proxyTriangles = triangleCount(shell)
    out.displayProxy = {
      available: true,
      capTriangles: cap,
      inputTriangles,
      proxyTriangles,
      owned,
      withinCap: proxyTriangles <= cap,
    }
    if (owned && shell !== dense) shell.dispose()
    dense.dispose()

    const small = new THREE.BoxGeometry(1, 1, 1)
    const smallResolved = resolver(small)
    out.displayProxy.passthroughUnderCap = !smallResolved.owned
    if (smallResolved.owned && smallResolved.geometry !== small) {
      smallResolved.geometry.dispose()
    }
    small.dispose()
  } catch {
    out.displayProxy.note = 'meshProxy helpers not on this branch'
  }

  return out
}

function loadGeometry(args) {
  if (args.quick) {
    const positions = new Float32Array(12_000 * 9)
    for (let i = 0; i < positions.length; i++) positions[i] = Math.sin(i * 0.013) * 40
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.computeVertexNormals()
    return {
      geometry: geo,
      meshFile: '(synthetic)',
      fileBytes: positions.byteLength,
      loadMs: 0,
    }
  }

  const meshPath = args.mesh
  if (!fs.existsSync(meshPath)) {
    throw new Error(`Mesh not found: ${meshPath}`)
  }
  const fileBytes = fs.statSync(meshPath).size
  const t0 = performance.now()
  const geometry = loadSTLFromArrayBuffer(fs.readFileSync(meshPath).buffer)
  return {
    geometry,
    meshFile: path.relative(ROOT, meshPath),
    fileBytes,
    loadMs: roundMs(performance.now() - t0),
  }
}

async function runBenchmark(args) {
  const git = gitMeta()
  const featureChecks = await loadOptionalFeatureChecks()
  const loaded = loadGeometry(args)
  const { geometry, meshFile, fileBytes, loadMs } = loaded
  const planePoint = planePointFromStock(DEFAULT_STOCK)

  const meshMetrics = {
    file: meshFile,
    fileBytes,
    fileMiB: roundMs(fileBytes / (1024 * 1024)),
    loadMs,
    triangles: triangleCount(geometry),
    vertices: geometry.attributes.position.count,
    buffers: byteCount(geometry),
  }

  const pipelineMode = pipelineUsesSharedSlice(runToolpathPipeline)
    ? 'shared-slice'
    : 'per-angle-clone'

  const totalMemory = createMemoryTracker()
  totalMemory.mark('heapBeforePipeline')

  const { result: pipelinePack, cloneCount: pipelineClones } = await withCloneCounter(async () => {
    const t0 = performance.now()
    const job = await runToolpathPipeline(geometry, {
      rotationN: args.rotationN,
      stock: DEFAULT_STOCK,
      cutMode: CUT_MODE_LEFT_ONLY,
      planePoint,
      onProgress: (done, total) => {
        totalMemory.mark(`pipeline_${done}/${total}`)
      },
    })
    return { job, totalMs: roundMs(performance.now() - t0) }
  })
  const pipelineJob = pipelinePack.job

  totalMemory.mark('heapAfterPipeline')

  const phased = await withCloneCounter(async () => runPhasedToolpath({
    geometry,
    rotationN: args.rotationN,
    stock: DEFAULT_STOCK,
    cutMode: CUT_MODE_LEFT_ONLY,
    planePoint,
    buildCutJob,
    extractOverlayContour,
    attachIndexSafetyToJob,
    geometryForToolpathSlicing,
    silhouetteOptsFromStock,
    OVERLAY_CONTOUR_VERSION,
    runToolpathPipeline,
  }))

  const overlayPoints = pipelineJob.cuts.reduce((sum, cut) => sum + (cut.overlayContour?.length ?? 0), 0)
  const profilePoints = pipelineJob.cuts.reduce(
    (sum, cut) => sum + (cut.profile?.pointCount ?? 0),
    0,
  )

  geometry.dispose()

  return {
    meta: {
      ...git,
      timestamp: new Date().toISOString(),
      runner: 'node',
      node: process.version,
    },
    mesh: meshMetrics,
    featureChecks,
    toolpath: {
      rotationN: args.rotationN,
      cutMode: CUT_MODE_LEFT_ONLY,
      cutCount: pipelineJob.cutCount ?? pipelineJob.cuts.length,
      pipelineMode,
      cloneCountDuringPipeline: pipelineClones,
      cloneCountDuringPhased: phased.cloneCount,
      profilePointCount: profilePoints,
      overlayPointCount: overlayPoints,
      timingsMs: {
        loadStl: loadMs,
        totalPipeline: pipelinePack.totalMs,
        ...phased.result.timingsMs,
        phasedTotal: roundMs(
          phased.result.timingsMs.profilePhase
          + phased.result.timingsMs.overlayPhase
          + phased.result.timingsMs.indexSafetyPhase,
        ),
      },
      memoryBytes: {
        pipeline: totalMemory.report(),
        phased: phased.result.memory,
      },
    },
  }
}

function printSummary(report) {
  const t = report.toolpath.timingsMs
  const mem = report.toolpath.memoryBytes.phased
  console.log('')
  console.log(`Branch: ${report.meta.branch} (${report.meta.commit})`)
  console.log(`Mesh: ${report.mesh.file} — ${report.mesh.triangles.toLocaleString()} tris, ${report.mesh.fileMiB} MiB file`)
  console.log(`Pipeline mode: ${report.toolpath.pipelineMode}`)
  console.log(`Clones during pipeline: ${report.toolpath.cloneCountDuringPipeline}`)
  console.log('')
  console.log('Timings (ms):')
  console.log(`  load STL       ${t.loadStl}`)
  console.log(`  profile phase  ${t.profilePhase}`)
  console.log(`  overlay phase  ${t.overlayPhase}`)
  console.log(`  index safety   ${t.indexSafetyPhase}`)
  console.log(`  total pipeline ${t.totalPipeline}`)
  console.log('')
  console.log('Peak heap (phased run):')
  console.log(`  ${mem.peakMiB} MiB at "${mem.peakMark}"`)
  if (report.featureChecks.displayProxy.available) {
    const p = report.featureChecks.displayProxy
    console.log('')
    console.log(`Display proxy: ${p.inputTriangles.toLocaleString()} → ${p.proxyTriangles.toLocaleString()} tris (cap ${p.capTriangles.toLocaleString()})`)
  }
  if (report.featureChecks.importLimit.available) {
    const lim = report.featureChecks.importLimit
    console.log(`Import limit: ${lim.maxMiB} MiB — reject over limit: ${lim.rejectsOverLimit}`)
  }
  console.log('')
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help) {
    printHelp()
    return
  }

  const report = await runBenchmark(args)
  const json = `${JSON.stringify(report, null, 2)}\n`

  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true })
    fs.writeFileSync(args.out, json)
    if (!args.jsonOnly) {
      console.log(`Wrote ${args.out}`)
      printSummary(report)
    }
  } else if (!args.jsonOnly) {
    printSummary(report)
    console.log(json)
  } else {
    process.stdout.write(json)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

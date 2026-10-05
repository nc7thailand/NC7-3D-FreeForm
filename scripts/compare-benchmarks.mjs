#!/usr/bin/env node
/**
 * Compare two benchmark-toolpath JSON reports (baseline vs candidate).
 *
 *   node scripts/compare-benchmarks.mjs .benchmark/main.json .benchmark/feature.json
 */

import fs from 'node:fs'
import path from 'node:path'
import { formatBytes, roundMiB, roundMs } from './benchmark/lib.mjs'

function loadJson(file) {
  const text = fs.readFileSync(file, 'utf8')
  return JSON.parse(text)
}

function pctChange(baseline, candidate) {
  if (!baseline) return null
  return roundMs(((candidate - baseline) / baseline) * 100)
}

function fmtDelta(baseline, candidate, unit = 'ms', invertGood = false) {
  const delta = roundMs(candidate - baseline)
  const pct = pctChange(baseline, candidate)
  const improved = invertGood ? delta < 0 : delta > 0
  const sign = delta > 0 ? '+' : ''
  const tag = improved ? 'better' : delta === 0 ? 'same' : 'worse'
  return `${baseline}${unit} → ${candidate}${unit} (${sign}${delta}${unit}, ${sign}${pct}%) [${tag}]`
}

function row(label, baseline, candidate, opts = {}) {
  const { unit = 'ms', invertGood = false, skipIfMissing = false } = opts
  if (baseline == null || candidate == null) {
    if (skipIfMissing) return null
    console.log(`${label.padEnd(28)} —`)
    return
  }
  console.log(`${label.padEnd(28)} ${fmtDelta(baseline, candidate, unit, invertGood)}`)
}

function main() {
  const baselinePath = process.argv[2]
  const candidatePath = process.argv[3]
  if (!baselinePath || !candidatePath) {
    console.error('Usage: node scripts/compare-benchmarks.mjs <baseline.json> <candidate.json>')
    process.exit(1)
  }

  const baseline = loadJson(baselinePath)
  const candidate = loadJson(candidatePath)
  const b = baseline.toolpath
  const c = candidate.toolpath
  const bt = b.timingsMs
  const ct = c.timingsMs
  const bm = b.memoryBytes.phased
  const cm = c.memoryBytes.phased

  console.log('')
  console.log('NC7 Toolpath A/B Benchmark Report')
  console.log('==================================')
  console.log(`Baseline:  ${baseline.meta.branch} (${baseline.meta.commit})`)
  console.log(`Candidate: ${candidate.meta.branch} (${candidate.meta.commit})`)
  console.log(`Mesh: ${baseline.mesh.file} — ${baseline.mesh.triangles.toLocaleString()} triangles`)
  console.log('')
  console.log('Execution time')
  console.log('----------------')
  row('Load STL', bt.loadStl, ct.loadStl)
  row('Profile / silhouette', bt.profilePhase, ct.profilePhase, { invertGood: true })
  row('Overlay grid', bt.overlayPhase, ct.overlayPhase, { invertGood: true })
  row('Index safety', bt.indexSafetyPhase, ct.indexSafetyPhase, { invertGood: true })
  row('Total pipeline', bt.totalPipeline, ct.totalPipeline, { invertGood: true })
  console.log('')
  console.log('Peak JS heap (phased run)')
  console.log('-------------------------')
  row('Peak heap (MiB)', roundMiB(bm.peakBytes), roundMiB(cm.peakBytes), { invertGood: true })
  console.log(`  Baseline peak at:  "${bm.peakMark}" (${roundMiB(bm.peakBytes)} MiB)`)
  console.log(`  Candidate peak at: "${cm.peakMark}" (${roundMiB(cm.peakBytes)} MiB)`)
  const heapSaved = bm.peakBytes - cm.peakBytes
  if (heapSaved > 0) {
    console.log(`  Heap reduction: ${formatBytes(heapSaved)} (${pctChange(bm.peakBytes, cm.peakBytes)}%)`)
  }
  console.log('')
  console.log('Mesh / clone metrics')
  console.log('--------------------')
  console.log(`Pipeline mode:     ${b.pipelineMode} → ${c.pipelineMode}`)
  console.log(`Geometry clones:   ${b.cloneCountDuringPipeline} → ${c.cloneCountDuringPipeline}`)
  console.log(`Overlay points:    ${b.overlayPointCount} → ${c.overlayPointCount}`)

  const bProxy = baseline.featureChecks.displayProxy
  const cProxy = candidate.featureChecks.displayProxy
  if (bProxy?.available || cProxy?.available) {
    console.log('')
    console.log('Display proxy (feature branch checks)')
    console.log('-------------------------------------')
    if (bProxy?.available) {
      console.log(`Baseline:  ${bProxy.inputTriangles} → ${bProxy.proxyTriangles} tris (cap ${bProxy.capTriangles})`)
    } else {
      console.log('Baseline:  (not available on this branch)')
    }
    if (cProxy?.available) {
      console.log(`Candidate: ${cProxy.inputTriangles} → ${cProxy.proxyTriangles} tris (cap ${cProxy.capTriangles}, within cap: ${cProxy.withinCap})`)
    } else {
      console.log('Candidate: (not available on this branch)')
    }
  }

  const bLim = baseline.featureChecks.importLimit
  const cLim = candidate.featureChecks.importLimit
  if (bLim?.available || cLim?.available) {
    console.log('')
    console.log('Import size limit')
    console.log('-------------------')
    console.log(`Baseline:  ${bLim?.available ? `${bLim.maxMiB} MiB gate active` : 'not present'}`)
    console.log(`Candidate: ${cLim?.available ? `${cLim.maxMiB} MiB gate active (reject over: ${cLim.rejectsOverLimit})` : 'not present'}`)
  }

  console.log('')
  console.log('Summary')
  console.log('-------')
  const timeSaved = bt.totalPipeline - ct.totalPipeline
  if (timeSaved > 0) {
    console.log(`Candidate is ${roundMs(timeSaved)} ms faster on full pipeline (${pctChange(bt.totalPipeline, ct.totalPipeline)}%).`)
  } else if (timeSaved < 0) {
    console.log(`Candidate is ${roundMs(Math.abs(timeSaved))} ms slower on full pipeline (${pctChange(bt.totalPipeline, ct.totalPipeline)}%).`)
  } else {
    console.log('Full pipeline time unchanged.')
  }
  if (heapSaved > 0) {
    console.log(`Candidate peak heap is lower by ${formatBytes(heapSaved)}.`)
  } else if (heapSaved < 0) {
    console.log(`Candidate peak heap is higher by ${formatBytes(-heapSaved)}.`)
  }
  if (b.cloneCountDuringPipeline > c.cloneCountDuringPipeline) {
    console.log(`Geometry clones during pipeline dropped from ${b.cloneCountDuringPipeline} to ${c.cloneCountDuringPipeline}.`)
  }
  console.log('')
}

main()

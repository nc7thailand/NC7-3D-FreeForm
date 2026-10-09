#!/usr/bin/env node
/**
 * Run toolpath benchmark on a baseline ref vs current HEAD, then compare.
 *
 *   node scripts/benchmark-ab.mjs
 *   node scripts/benchmark-ab.mjs --baseline savepoint/pre-webview2-plan-2026-10-08
 *   node scripts/benchmark-ab.mjs --baseline main --candidate HEAD
 *
 * Requires a clean working tree (commit or stash first).
 * Temporarily checks out the baseline ref, then restores your branch for the candidate run.
 */

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BENCH_DIR = path.join(ROOT, '.benchmark')

function run(cmd, opts = {}) {
  const { inherit, cwd, ...rest } = opts
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: cwd ?? ROOT,
    stdio: inherit ? 'inherit' : 'pipe',
    ...rest,
  })
}

function slugRef(ref) {
  return ref.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'ref'
}

function parseArgs(argv) {
  const args = {
    baseline: 'savepoint/pre-webview2-plan-2026-10-08',
    candidate: 'HEAD',
    mesh: null,
    rotationN: null,
    quick: false,
  }
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--baseline') args.baseline = argv[++i]
    else if (arg === '--candidate') args.candidate = argv[++i]
    else if (arg === '--mesh') args.mesh = argv[++i]
    else if (arg === '--rotation-n') args.rotationN = argv[++i]
    else if (arg === '--quick') args.quick = true
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/benchmark-ab.mjs [options]

Options:
  --baseline <ref>   Git ref for "before" (default: savepoint/pre-webview2-plan-2026-10-08)
  --candidate <ref>  Git ref for "after"  (default: HEAD — run on restored branch)
  --mesh <path>      STL path passed to benchmark-toolpath.mjs
  --rotation-n <n>   Cut count driver N
  --quick            Synthetic mesh (faster smoke run)
`)
      process.exit(0)
    }
  }
  return args
}

function benchCmd(extra) {
  const parts = ['node', 'scripts/benchmark-toolpath.mjs']
  if (extra.mesh) parts.push('--mesh', extra.mesh)
  if (extra.rotationN) parts.push('--rotation-n', String(extra.rotationN))
  if (extra.quick) parts.push('--quick')
  parts.push('--out', extra.out)
  return parts.join(' ')
}

function resolveCommit(ref) {
  return run(`git rev-parse --short ${ref}`).trim()
}

function main() {
  const args = parseArgs(process.argv)
  const dirty = run('git status --porcelain').trim()
  if (dirty) {
    console.error('Working tree must be clean before benchmark A/B. Commit or stash changes.')
    process.exit(1)
  }

  fs.mkdirSync(BENCH_DIR, { recursive: true })

  const returnRef = run('git rev-parse --abbrev-ref HEAD').trim()
  const baselineSlug = slugRef(args.baseline)
  const candidateSlug = slugRef(args.candidate === 'HEAD' ? returnRef : args.candidate)
  const beforeOut = path.join(BENCH_DIR, `before-${baselineSlug}.json`)
  const afterOut = path.join(BENCH_DIR, `after-${candidateSlug}.json`)
  const reportOut = path.join(BENCH_DIR, `ab-report-${baselineSlug}-vs-${candidateSlug}.txt`)
  const benchOpts = { mesh: args.mesh, rotationN: args.rotationN, quick: args.quick }

  console.log('')
  console.log('NC7 benchmark A/B')
  console.log('=================')
  console.log(`Baseline:  ${args.baseline} (${resolveCommit(args.baseline)})`)
  console.log(`Candidate: ${args.candidate} (${resolveCommit(args.candidate)})`)
  console.log(`Return to: ${returnRef}`)
  console.log('')

  try {
    console.log('Checking out baseline …')
    run(`git checkout ${args.baseline}`, { inherit: true })

    console.log('')
    console.log('Running baseline benchmark …')
    run(benchCmd({ ...benchOpts, out: beforeOut }), { inherit: true })

    const candidateRef = args.candidate === 'HEAD' ? returnRef : args.candidate
    console.log('')
    console.log(`Checking out candidate (${candidateRef}) …`)
    run(`git checkout ${candidateRef}`, { inherit: true })

    console.log('')
    console.log('Running candidate benchmark …')
    run(benchCmd({ ...benchOpts, out: afterOut }), { inherit: true })

    console.log('')
    console.log('Comparing reports …')
    const report = run(`node scripts/compare-benchmarks.mjs "${beforeOut}" "${afterOut}"`)
    fs.writeFileSync(reportOut, report, 'utf8')
    process.stdout.write(report)

    console.log('')
    console.log('Saved:')
    console.log(`  ${path.relative(ROOT, beforeOut)}`)
    console.log(`  ${path.relative(ROOT, afterOut)}`)
    console.log(`  ${path.relative(ROOT, reportOut)}`)
    console.log('')
  } finally {
    console.log(`Restoring branch ${returnRef} …`)
    run(`git checkout ${returnRef}`, { inherit: true })
  }
}

main()

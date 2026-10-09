import * as THREE from 'three'
import { cuttingPlane } from '../src/lib/toolpath.js'
import {
  extractFullSilhouette,
  extractLeftSilhouette,
  projectShadowGrid,
  silhouetteRasterEngine,
} from '../src/lib/silhouette.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function sameGrid(a, b, label) {
  assert(a.length === b.length, `${label} length ${a.length} vs ${b.length}`)
  let mismatches = 0
  let first = -1
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      if (first < 0) first = i
      mismatches += 1
    }
  }
  assert(mismatches === 0, `${label} grid mismatches ${mismatches} (first ${first})`)
}

function samePoints(a, b, label) {
  assert(a.length === b.length, `${label} point count ${a.length} vs ${b.length}`)
  for (let i = 0; i < a.length; i++) {
    if (a[i].u !== b[i].u || a[i].v !== b[i].v) {
      throw new Error(`${label} point ${i} (${a[i].u},${a[i].v}) vs (${b[i].u},${b[i].v})`)
    }
  }
}

function compareGrid(geometry, frame, opts, label) {
  const js = projectShadowGrid(geometry, frame, opts, 'js')
  const wasm = projectShadowGrid(geometry, frame, opts, 'wasm')
  assert(js && wasm, `${label} produced a grid`)
  assert(js.engine === 'js', `${label} js engine`)
  assert(wasm.engine === 'wasm', `${label} wasm engine was ${wasm.engine}`)
  assert(js.spec.uBins === wasm.spec.uBins && js.spec.vBins === wasm.spec.vBins, `${label} spec`)
  sameGrid(js.grid, wasm.grid, label)
  const occupied = wasm.grid.reduce((sum, cell) => sum + cell, 0)
  assert(occupied > 0, `${label} grid is empty`)
}

function compareSilhouette(geometry, frame, opts, label) {
  globalThis.__NC7_SILHOUETTE_WASM__ = false
  const jsLeft = extractLeftSilhouette(geometry, frame, opts)
  const jsFull = extractFullSilhouette(geometry, frame, opts)
  globalThis.__NC7_SILHOUETTE_WASM__ = true
  const wasmLeft = extractLeftSilhouette(geometry, frame, opts)
  const wasmFull = extractFullSilhouette(geometry, frame, opts)
  assert(silhouetteRasterEngine() === 'wasm', `${label} silhouette did not use wasm`)
  samePoints(jsLeft, wasmLeft, `${label} left`)
  samePoints(jsFull, wasmFull, `${label} full`)
  delete globalThis.__NC7_SILHOUETTE_WASM__
}

const anchor = new THREE.Vector3(0, 0, -15)
const box = new THREE.BoxGeometry(10, 20, 30)
for (const theta of [0, 30, 90, 180, 270]) {
  const frame = cuttingPlane(theta, anchor)
  compareGrid(box, frame, { profileAccuracy: 5 }, `box theta ${theta}`)
  compareGrid(box, frame, { profileAccuracy: 8, gridBins: 240 }, `box overlay theta ${theta}`)
  compareSilhouette(box, frame, { profileAccuracy: 5, gridBins: 120 }, `box silhouette ${theta}`)
}

const indexed = box
const nonIndexed = indexed.toNonIndexed()
compareGrid(nonIndexed, cuttingPlane(45, anchor), { profileAccuracy: 6 }, 'non-indexed box')

const u16 = indexed.clone()
u16.setIndex(new THREE.BufferAttribute(new Uint16Array(indexed.getIndex().array), 1))
compareGrid(u16, cuttingPlane(12.5, anchor), { profileAccuracy: 4 }, 'uint16 index')

const degenerate = new THREE.BufferGeometry()
degenerate.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
  0, 0, 0, 0, 0, 0, 0, 0, 0,
  -4, 0, -2, 4, 0, -2, 0, 8, 2,
]), 3))
compareGrid(degenerate, cuttingPlane(15, anchor), { profileAccuracy: 5 }, 'degenerate plus triangle')

const positions = new Float32Array(3000 * 9)
for (let i = 0; i < positions.length; i += 3) {
  positions[i] = ((i * 17) % 200) / 10 - 10
  positions[i + 1] = ((i * 13) % 160) / 8
  positions[i + 2] = ((i * 19) % 180) / 9 - 10
}
const dense = new THREE.BufferGeometry()
dense.setAttribute('position', new THREE.BufferAttribute(positions, 3))
const denseFrame = cuttingPlane(20, anchor)
compareGrid(dense, denseFrame, { profileAccuracy: 5 }, 'dense soup')
compareSilhouette(dense, denseFrame, { profileAccuracy: 5 }, 'dense silhouette')

const jsStarted = performance.now()
projectShadowGrid(dense, denseFrame, { profileAccuracy: 7 }, 'js')
const jsMs = performance.now() - jsStarted
const wasmStarted = performance.now()
projectShadowGrid(dense, denseFrame, { profileAccuracy: 7 }, 'wasm')
const wasmMs = performance.now() - wasmStarted
console.log(`silhouette raster 3000 tris: js ${jsMs.toFixed(1)} ms, wasm ${wasmMs.toFixed(1)} ms`)

box.dispose()
nonIndexed.dispose()
u16.dispose()
degenerate.dispose()
dense.dispose()
console.log('silhouette wasm ok')

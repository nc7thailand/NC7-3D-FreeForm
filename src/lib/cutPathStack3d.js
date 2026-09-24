// 3D preview layers from CAM cut blocks (green lead-in → cut → red lead-out).
// Reads the same cutBlockForCut() chain the G-code emitter uses — no G-code parsing.

import { cutBlockForCut } from './gcodePath.js'
import { cuttingPlane, planePointMiddleFromStock } from './toolpath.js'
import { buildIndexTransitionPlan, isLeftOnlyIndexPlan, isLRIndexPlan } from './indexing/indexRouter.js'

export const PREVIEW_VIEW = {
  /** Layers side by side on Z at their rotary value (1 mm = 1°) — the "comb". */
  STACK: 'stack',
  /** Each layer rotated to its cut angle around the vertical rotary axis. */
  ASSEMBLED: 'assembled',
}

/**
 * @typedef {{ x: number, y: number, z: number }} P3
 * @typedef {{
 *   index: number,
 *   thetaDeg: number,
 *   layerZ: number,
 *   leadIn: P3[],
 *   cut: P3[],
 *   leadOut: P3[],
 *   simDotLinks: { fromIndex: number, points: P3[] }[],
 *   rotaryLink?: P3[],
 *   chain: import('./gcodePath.js').CutBlockChain,
 * }} CutPathLayer
 */

/**
 * Rotary index (1 mm = 1°) for one cut block — the value the G-code emits.
 *
 * @param {object} cutJob
 * @param {{ index: number }} cut
 */
export function layerZForCut(cutJob, cut) {
  const n = cutJob?.rotationN ?? cutJob?.cuts?.length ?? 1
  const step = 360 / Math.max(n, 1)
  return cut.index * step
}

function layerMapper(viewMode, cutJob, cut) {
  if (viewMode === PREVIEW_VIEW.ASSEMBLED) {
    // Same −θ axis extractOverlayContour projects with, so u unprojects onto the model.
    const { uAxis } = cuttingPlane(-cut.thetaDeg, planePointMiddleFromStock())
    return (p) => ({ x: p.u * uAxis.x, y: p.v, z: p.u * uAxis.z })
  }
  const z = layerZForCut(cutJob, cut)
  return (p) => ({ x: p.u, y: p.v, z })
}

/**
 * @param {object|null} cutJob
 * @param {import('three').BufferGeometry|null} [geometry]
 * @param {{ viewMode?: string }} [options]
 * @returns {{ layers: CutPathLayer[], pointCount: number, bounds: object|null }}
 */
export function buildCutPathLayerStack(cutJob, geometry = null, { viewMode = PREVIEW_VIEW.STACK } = {}) {
  if (!cutJob?.cuts?.length) {
    return { layers: [], pointCount: 0, bounds: null }
  }

  const ctx = {
    geometry: geometry ?? cutJob.geometry ?? null,
    stock: cutJob.stock ?? {},
    cutMode: cutJob.mode,
  }
  const layers = []
  let pointCount = 0

  for (const cut of cutJob.cuts) {
    const chain = cutBlockForCut(cutJob, cut, ctx)
    if (!chain || chain.cut.length < 2) continue
    const map = layerMapper(viewMode, cutJob, cut)
    const layer = {
      index: cut.index,
      thetaDeg: cut.thetaDeg,
      layerZ: layerZForCut(cutJob, cut),
      leadIn: chain.leadIn.map(map),
      cut: chain.cut.map(map),
      leadOut: chain.leadOut.map(map),
      simDotLinks: [],
      chain,
    }
    layers.push(layer)
    pointCount += layer.cut.length + Math.max(layer.leadIn.length - 1, 0) + Math.max(layer.leadOut.length - 1, 0)
  }

  if (viewMode === PREVIEW_VIEW.STACK) {
    attachTransitionLinks(layers, cutJob, ctx)
  }

  return {
    layers,
    pointCount,
    bounds: boundsFromLayers(layers),
  }
}

/**
 * Transitions (left-only and left-to-right), from the same index plan the G-code uses:
 * - simDotLink (yellow): the X rapid red → simDot K at the red marker's level,
 *   on layer N when it moves before the turn (preMoveToK), else on layer N+1.
 * - rotaryLink (white): the rotary index, drawn along Z from layer N to N+1
 *   at the XY where the turn happens (K when preMoveToK, else the red marker).
 */
function attachTransitionLinks(layers, cutJob, ctx) {
  if (!ctx.geometry) return
  for (let i = 0; i < layers.length - 1; i++) {
    const layer = layers[i]
    const next = layers[i + 1]
    const plan = buildIndexTransitionPlan({
      geometry: ctx.geometry,
      stock: ctx.stock,
      rotationN: cutJob.rotationN,
      cutMode: cutJob.mode,
      cutIndex: layer.index,
      thetaDeg: layer.thetaDeg,
      nextCutGreen: next.chain.green,
    })
    if (!isLeftOnlyIndexPlan(plan) && !isLRIndexPlan(plan)) continue
    const red = layer.chain.red
    if (!red) continue

    const k = plan.k ?? next.chain.green
    const turnAt = k && plan.preMoveToK ? k : red
    layer.rotaryLink = [
      { x: turnAt.u, y: turnAt.v, z: layer.layerZ },
      { x: turnAt.u, y: turnAt.v, z: next.layerZ },
    ]

    if (!k || Math.hypot(red.u - k.u, red.v - k.v) < 1e-6) continue
    const owner = plan.preMoveToK ? layer : next
    owner.simDotLinks.push({
      fromIndex: layer.index,
      points: [red, k].map((p) => ({ x: p.u, y: p.v, z: owner.layerZ })),
    })
  }
}

/** @param {CutPathLayer[]} layers */
export function boundsFromLayers(layers) {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  let count = 0

  for (const layer of layers) {
    for (const part of [layer.leadIn, layer.cut, layer.leadOut, ...layer.simDotLinks.map((l) => l.points), layer.rotaryLink ?? []]) {
      for (const p of part) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        minZ = Math.min(minZ, p.z)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
        maxZ = Math.max(maxZ, p.z)
        count += 1
      }
    }
  }

  if (!count) return null

  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    center: {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2,
    },
    radius: Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1) * 0.55,
  }
}

// 3D preview layers from CAM cut blocks (green lead-in → cut → red lead-out).
// Reads the same cutBlockForCut() chain the G-code emitter uses — no G-code parsing.

import { cutBlockForCut } from './gcodePath.js'
import { gcodeOriginFromStock, overlayPointToGcode } from './gcodeCoords.js'
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

function assembledMapper(thetaDeg, stock) {
  // Same −θ axis extractOverlayContour projects with; machine u/v include work origin.
  const { uAxis } = cuttingPlane(-thetaDeg, planePointMiddleFromStock())
  return (p) => {
    const { x: u, y: v } = overlayToGcodeXY(stock, p)
    return { x: u * uAxis.x, y: v, z: u * uAxis.z }
  }
}

const ROTARY_ARC_STEP_DEG = 2

/** Fixed machine point (u, v) swept from θa to θb, seen in the assembled (foam) frame. */
function assembledRotaryArc(p, thetaA, thetaB, stock) {
  const steps = Math.max(2, Math.ceil(Math.abs(thetaB - thetaA) / ROTARY_ARC_STEP_DEG))
  const pts = []
  for (let s = 0; s <= steps; s++) {
    pts.push(assembledMapper(thetaA + ((thetaB - thetaA) * s) / steps, stock)(p))
  }
  return pts
}

/** Overlay middle-plane (u, v) → machine G-code (X, Y) using stock work origin. */
function overlayToGcodeXY(stock, p) {
  const g = overlayPointToGcode(p, gcodeOriginFromStock(stock))
  return g ?? { x: p.u, y: p.v }
}

function layerMapper(viewMode, cutJob, cut) {
  const stock = cutJob.stock ?? {}
  if (viewMode === PREVIEW_VIEW.ASSEMBLED) return assembledMapper(cut.thetaDeg, stock)
  const z = layerZForCut(cutJob, cut)
  return (p) => ({ ...overlayToGcodeXY(stock, p), z })
}

/**
 * @param {object|null} cutJob
 * @param {import('three').BufferGeometry|null} [geometry]
 * @param {{ viewMode?: string }} [options]
 * @returns {{ layers: CutPathLayer[], pointCount: number, bounds: object|null }}
 */
export function buildCutPathLayerStack(cutJob, geometry = null, { viewMode = PREVIEW_VIEW.STACK } = {}) {
  if (!cutJob?.cuts?.length) return emptyStack()
  const ctx = stackContext(cutJob, geometry)
  const layers = []
  for (const cut of cutJob.cuts) {
    const layer = buildLayer(cutJob, cut, ctx, viewMode)
    if (layer) layers.push(layer)
  }
  return finishStack(layers, cutJob, ctx, viewMode)
}

/**
 * Same result as buildCutPathLayerStack, built one cut at a time so a caller
 * can show progress. `onProgress(done, total)` may return a promise (e.g. a
 * paint yield); total = cuts + 1 for the transition-link pass.
 */
export async function buildCutPathLayerStackAsync(cutJob, geometry = null, {
  viewMode = PREVIEW_VIEW.STACK,
  onProgress = null,
} = {}) {
  if (!cutJob?.cuts?.length) return emptyStack()
  const ctx = stackContext(cutJob, geometry)
  const total = cutJob.cuts.length + 1
  const layers = []
  for (let i = 0; i < cutJob.cuts.length; i++) {
    const layer = buildLayer(cutJob, cutJob.cuts[i], ctx, viewMode)
    if (layer) layers.push(layer)
    await onProgress?.(i + 1, total)
  }
  const stack = finishStack(layers, cutJob, ctx, viewMode)
  await onProgress?.(total, total)
  return stack
}

function emptyStack() {
  return { layers: [], pointCount: 0, bounds: null }
}

function stackContext(cutJob, geometry) {
  return {
    geometry: geometry ?? cutJob.geometry ?? null,
    stock: cutJob.stock ?? {},
    cutMode: cutJob.mode,
  }
}

function buildLayer(cutJob, cut, ctx, viewMode) {
  const chain = cutBlockForCut(cutJob, cut, ctx)
  if (!chain || chain.cut.length < 2) return null
  const map = layerMapper(viewMode, cutJob, cut)
  return {
    index: cut.index,
    thetaDeg: cut.thetaDeg,
    layerZ: layerZForCut(cutJob, cut),
    leadIn: chain.leadIn.map(map),
    cut: chain.cut.map(map),
    leadOut: chain.leadOut.map(map),
    simDotLinks: [],
    chain,
  }
}

function finishStack(layers, cutJob, ctx, viewMode) {
  attachTransitionLinks(layers, cutJob, ctx, viewMode)
  let pointCount = 0
  for (const layer of layers) {
    pointCount += layer.cut.length + Math.max(layer.leadIn.length - 1, 0) + Math.max(layer.leadOut.length - 1, 0)
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
 *   Layer stack view only.
 * - rotaryLink (white): the rotary index at the XY where the turn happens
 *   (K when preMoveToK, else the red marker). Layer stack: a line along Z from
 *   layer N to N+1. Assembled: an arc around the rotary axis from layer N's
 *   cut angle to layer N+1's.
 */
function attachTransitionLinks(layers, cutJob, ctx, viewMode) {
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

    if (viewMode === PREVIEW_VIEW.ASSEMBLED) {
      layer.rotaryLink = assembledRotaryArc(turnAt, layer.thetaDeg, next.thetaDeg, ctx.stock)
      continue
    }

    const turnXY = overlayToGcodeXY(ctx.stock, turnAt)
    layer.rotaryLink = [
      { x: turnXY.x, y: turnXY.y, z: layer.layerZ },
      { x: turnXY.x, y: turnXY.y, z: next.layerZ },
    ]

    if (!k || Math.hypot(red.u - k.u, red.v - k.v) < 1e-6) continue
    const owner = plan.preMoveToK ? layer : next
    owner.simDotLinks.push({
      fromIndex: layer.index,
      points: [red, k].map((p) => ({ ...overlayToGcodeXY(ctx.stock, p), z: owner.layerZ })),
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

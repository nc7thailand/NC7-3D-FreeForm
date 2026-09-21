// Left-Only Index Sequence
//
// Odd N:  TOP → lower-left (toolpath). End (red) and simDot K both lower-left, different coords.
//         Odd→Even index: rapid I→K along linkage, then turn.
// Even N: lower-left → TOP (toolpath). End and simDot K coincide at TOP.
//         Even→Odd index: turn only — no rapids.

import { CUT_MODE_LEFT_ONLY, effectiveCutCount } from '../cutJob.js'
import {
  OVERLAY_COLORS,
  blockCenterU,
  buildOverlayData,
  projectedBlockWidth,
} from '../cutOverlay.js'
import { topSafeY } from '../wirePath.js'

/** Index rapids only after Odd N (Odd→Even). Even→Odd is rotate-only. */
export function leftOnlyNeedsIndexRapids(completedCutN) {
  return completedCutN % 2 === 1
}

/** Lower-left BO anchor (simDot / K) at θ. */
export function leftBoEntry(geometry, stock, thetaDeg) {
  if (!geometry) return null
  const projectedW = projectedBlockWidth(thetaDeg, stock)
  const uCenter = blockCenterU(geometry, thetaDeg)
  const margin = stock?.boMargin ?? 20
  return {
    u: uCenter - projectedW / 2 - margin,
    v: stock?.bo ?? 0,
  }
}

/** TOP entry on the rotation axis (odd-cut green / even-cut red). */
export function leftOnlyTopEntry(stock) {
  return { u: 0, v: topSafeY(stock) }
}

/**
 * Left-only simDot (K):
 *   Odd N  → next Even start (green @ lower-left BO, next cut θ)
 *   Even N → this Even end   (red @ TOP, current θ)
 */
export function leftOnlySimDot({ geometry, stock, rotationN, cutIndex, thetaDeg }) {
  const count = effectiveCutCount(rotationN ?? 0, { mode: CUT_MODE_LEFT_ONLY })
  if (!geometry || !count || cutIndex >= count - 1) return null

  const currentCutN = cutIndex + 1
  const isOdd = currentCutN % 2 === 1

  if (isOdd) {
    const nextCutIndex = cutIndex + 1
    const thetaNext = (nextCutIndex * 360) / count
    const { markers } = buildOverlayData({
      geometry,
      thetaDeg: thetaNext,
      stock,
      cutMode: CUT_MODE_LEFT_ONLY,
      cutIndex: nextCutIndex,
    })
    const green = markers.find((m) => m.color === OVERLAY_COLORS.green)
    if (!green || !Number.isFinite(green.u) || !Number.isFinite(green.v)) return null
    return { u: green.u, v: green.v }
  }

  const theta = Number.isFinite(thetaDeg) ? thetaDeg : (cutIndex * 360) / count
  const { markers } = buildOverlayData({
    geometry,
    thetaDeg: theta,
    stock,
    cutMode: CUT_MODE_LEFT_ONLY,
    cutIndex,
  })
  const red = markers.find((m) => m.color === OVERLAY_COLORS.red)
  if (!red || !Number.isFinite(red.u) || !Number.isFinite(red.v)) return null
  return { u: red.u, v: red.v }
}

/**
 * @returns {import('./indexRouter.js').LeftOnlyIndexPlan|null}
 */
export function buildLeftOnlyIndexPlan({
  geometry,
  stock,
  rotationN,
  cutMode,
  cutIndex,
  thetaDeg,
  nextCutGreen,
}) {
  const count = effectiveCutCount(rotationN ?? 0, { mode: cutMode })
  if (!geometry || !count || cutIndex >= count - 1) return null
  if (!nextCutGreen || !Number.isFinite(nextCutGreen.u) || !Number.isFinite(nextCutGreen.v)) {
    return null
  }

  const nextCutIndex = cutIndex + 1
  const currentCutN = cutIndex + 1
  const needsRapids = leftOnlyNeedsIndexRapids(currentCutN)

  const { markers } = buildOverlayData({
    geometry,
    thetaDeg,
    stock,
    cutMode,
    cutIndex,
  })
  const red = markers.find((m) => m.color === OVERLAY_COLORS.red)
  const k = leftOnlySimDot({ geometry, stock, rotationN, cutIndex, thetaDeg })

  if (!red || !k || !Number.isFinite(red.u) || !Number.isFinite(k.u)) return null

  return {
    mode: 'left-only',
    currentCutN,
    currentCutIsOdd: needsRapids,
    needsRapids,
    nextCutIndex,
    k,
    i: { u: red.u, v: red.v },
    top: leftOnlyTopEntry(stock),
    green: { u: nextCutGreen.u, v: nextCutGreen.v },
    afterRotate: 'finish',
  }
}

// Left-Only Index Sequence — vertical top↔down on u=0, BO anchor at left margin.

import { effectiveCutCount } from '../cutJob.js'
import {
  OVERLAY_COLORS,
  blockCenterU,
  buildOverlayData,
  projectedBlockWidth,
} from '../cutOverlay.js'
import { topSafeY } from '../wirePath.js'

/** Left BO entry (simDot / K) at a given θ — always v = BO. */
export function leftBoEntry(geometry, stock, thetaDeg) {
  if (!geometry) return null
  const projectedW = projectedBlockWidth(thetaDeg, stock)
  const uCenter = blockCenterU(geometry, thetaDeg)
  const margin = stock?.boMargin ?? 20
  const boV = stock?.bo ?? 0
  return {
    u: uCenter - projectedW / 2 - margin,
    v: boV,
  }
}

/** Top safe on the rotation axis. */
export function leftOnlyTopEntry(stock) {
  return { u: 0, v: topSafeY(stock) }
}

/** u=0 at BO — end of the vertical leg before horizontal to left BO. */
export function leftOnlyAxisAtBo(stock) {
  return { u: 0, v: stock?.bo ?? 0 }
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
  const currentCutIsOdd = currentCutN % 2 === 1

  const { markers } = buildOverlayData({
    geometry,
    thetaDeg,
    stock,
    cutMode,
    cutIndex,
  })
  const red = markers.find((m) => m.color === OVERLAY_COLORS.red)
  const k = leftBoEntry(geometry, stock, thetaDeg)
  const top = leftOnlyTopEntry(stock)
  const axisBo = leftOnlyAxisAtBo(stock)

  if (!red || !k || !Number.isFinite(red.u) || !Number.isFinite(k.u)) return null

  const i = { u: red.u, v: red.v }

  // Odd N ending: wire + K at BO → turn → next even starts at BO.
  // Even N ending: wire at TOP → turn → down (u=0) → horizontal to K → up to TOP.
  return {
    mode: 'left-only',
    currentCutN,
    currentCutIsOdd,
    nextCutIndex,
    k,
    i,
    top,
    axisBo,
    green: { u: nextCutGreen.u, v: nextCutGreen.v },
    /** @type {'finish' | 'down-to-bo-then-top'} */
    afterRotate: currentCutIsOdd ? 'finish' : 'down-to-bo-then-top',
  }
}

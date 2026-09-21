// L-R Index Sequence — horizontal K vs red, odd/even N parity.

import { effectiveCutCount } from '../cutJob.js'
import { OVERLAY_COLORS, buildOverlayData } from '../cutOverlay.js'
import { nextSimDot } from '../simOverlay3d.js'

/** @typedef {'left' | 'right'} IndexEntrySide */

export function indexEntrySideLR(nextCutIndex) {
  return (nextCutIndex + 1) % 2 === 1 ? 'left' : 'right'
}

export function kNearerCenterThanRed(side, kU, iU) {
  if (!Number.isFinite(kU) || !Number.isFinite(iU)) return false
  if (side === 'left') return kU > iU
  return kU < iU
}

export function kFartherOutThanRed(side, kU, iU) {
  if (!Number.isFinite(kU) || !Number.isFinite(iU)) return false
  if (Math.abs(kU - iU) <= 1e-3) return false
  return !kNearerCenterThanRed(side, kU, iU)
}

/** @deprecated */
export function indexSafetyNeeded(side, kU, iU) {
  return kFartherOutThanRed(side, kU, iU)
}

export function assessLRIndexSafety({
  geometry,
  stock,
  rotationN,
  cutMode,
  cutIndex,
  thetaDeg,
}) {
  const count = effectiveCutCount(rotationN ?? 0, { mode: cutMode })
  if (!geometry || !count || cutIndex >= count - 1) return null

  const nextCutIndex = cutIndex + 1
  const side = indexEntrySideLR(nextCutIndex)

  const { markers } = buildOverlayData({
    geometry,
    thetaDeg,
    stock,
    cutMode,
    cutIndex,
  })
  const red = markers.find((m) => m.color === OVERLAY_COLORS.red)
  const k = nextSimDot({ geometry, stock, rotationN, cutMode, cutIndex })

  if (!red || !k || !Number.isFinite(red.u) || !Number.isFinite(k.u)) return null

  const i = { u: red.u, v: red.v }
  const nearer = kNearerCenterThanRed(side, k.u, i.u)
  const farther = kFartherOutThanRed(side, k.u, i.u)
  const currentCutN = cutIndex + 1
  const currentCutIsOdd = currentCutN % 2 === 1

  return {
    preMoveToK: farther,
    postMoveToK: nearer,
    postMoveToI: farther && !currentCutIsOdd,
    indexEndsAtTurn: currentCutIsOdd && farther,
    currentCutN,
    side,
    k,
    i,
    nextCutIndex,
  }
}

/**
 * @returns {import('./indexRouter.js').LRIndexPlan|null}
 */
export function buildLRIndexPlan({
  geometry,
  stock,
  rotationN,
  cutMode,
  cutIndex,
  thetaDeg,
  nextCutGreen,
}) {
  if (!nextCutGreen || !Number.isFinite(nextCutGreen.u) || !Number.isFinite(nextCutGreen.v)) {
    return null
  }

  const safety = assessLRIndexSafety({
    geometry,
    stock,
    rotationN,
    cutMode,
    cutIndex,
    thetaDeg,
  })

  const nextCutIndex = cutIndex + 1
  if (!safety) {
    return {
      mode: 'left-to-right',
      preMoveToK: false,
      postMoveToK: false,
      postMoveToI: false,
      indexEndsAtTurn: false,
      side: indexEntrySideLR(nextCutIndex),
      k: null,
      i: null,
      green: { u: nextCutGreen.u, v: nextCutGreen.v },
      nextCutIndex,
    }
  }

  return {
    mode: 'left-to-right',
    preMoveToK: safety.preMoveToK,
    postMoveToK: safety.postMoveToK,
    postMoveToI: safety.postMoveToI,
    indexEndsAtTurn: safety.indexEndsAtTurn,
    side: safety.side,
    k: safety.k,
    i: safety.i,
    green: { u: nextCutGreen.u, v: nextCutGreen.v },
    nextCutIndex,
  }
}

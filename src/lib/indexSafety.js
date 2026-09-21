// Indexing (turntable turn) safety between cuts — shared by sim and G-code.
//
// Compare simDot K vs red retract I relative to x=0 (model center):
//   K nearer center → rotate at red, then rapid to K (even N ending)
//   K farther out   → rapid to K, rotate (odd N ends here), or + rapid to I (even N)

import { CUT_MODE_LEFT_ONLY, effectiveCutCount } from './cutJob.js'
import { OVERLAY_COLORS, buildOverlayData } from './cutOverlay.js'
import { nextSimDot } from './simOverlay3d.js'

/** @typedef {'left' | 'right'} IndexEntrySide */

const U_MATCH_TOL = 1e-3

/**
 * Which side the next cut enters from (L-R parity; left-only is always left).
 *
 * @param {string} cutMode
 * @param {number} nextCutIndex - 0-based index of the upcoming cut
 * @returns {IndexEntrySide}
 */
export function indexEntrySide(cutMode, nextCutIndex) {
  if (cutMode === CUT_MODE_LEFT_ONLY) return 'left'
  return (nextCutIndex + 1) % 2 === 1 ? 'left' : 'right'
}

/**
 * simDot K is closer to x=0 than red I (toward the model).
 *
 * @param {IndexEntrySide} side
 * @param {number} kU
 * @param {number} iU
 */
export function kNearerCenterThanRed(side, kU, iU) {
  if (!Number.isFinite(kU) || !Number.isFinite(iU)) return false
  if (side === 'left') return kU > iU
  return kU < iU
}

/**
 * simDot K is farther from x=0 than red I (more outside).
 *
 * @param {IndexEntrySide} side
 * @param {number} kU
 * @param {number} iU
 */
export function kFartherOutThanRed(side, kU, iU) {
  if (!Number.isFinite(kU) || !Number.isFinite(iU)) return false
  if (Math.abs(kU - iU) <= U_MATCH_TOL) return false
  return !kNearerCenterThanRed(side, kU, iU)
}

/** @deprecated use kFartherOutThanRed — kept for stored cutJob.indexSafety */
export function indexSafetyNeeded(side, kU, iU) {
  return kFartherOutThanRed(side, kU, iU)
}

/**
 * Assess index transition geometry for cutIndex → cutIndex + 1.
 *
 * @returns {{
 *   preMoveToK: boolean,
 *   postMoveToK: boolean,
 *   postMoveToI: boolean,
 *   indexEndsAtTurn: boolean,
 *   currentCutN: number,
 *   side: IndexEntrySide,
 *   k: { u: number, v: number },
 *   i: { u: number, v: number },
 *   nextCutIndex: number,
 * } | null}
 */
export function assessIndexSafety({
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
  const side = indexEntrySide(cutMode, nextCutIndex)

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

  // Odd N ending (L-R): pre-K → turn → done (wire already at next entry K).
  // Post-I and a second move to simDot only apply after even N.
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
 * Animate wire U toward a target (rapid move). Mutates `point.u`.
 *
 * @returns {boolean} true when target reached
 */
export function stepTowardU(point, targetU, speedMmPerSec, dtSec) {
  if (!point || !Number.isFinite(targetU)) return true
  const dx = targetU - point.u
  if (Math.abs(dx) < U_MATCH_TOL) {
    point.u = targetU
    return true
  }
  const step = Math.sign(dx || 1) * speedMmPerSec * dtSec
  if (Math.abs(dx) <= Math.abs(step)) {
    point.u = targetU
    return true
  }
  point.u += step
  return false
}

/**
 * Animate wire (u,v) toward a target point. Mutates `point`.
 *
 * @returns {boolean} true when target reached
 */
export function stepTowardUV(point, target, speedMmPerSec, dtSec) {
  if (!point || !target) return true
  if (!Number.isFinite(target.u) || !Number.isFinite(target.v)) return true
  const dx = target.u - point.u
  const dy = target.v - point.v
  const dist = Math.hypot(dx, dy)
  if (dist < U_MATCH_TOL) {
    point.u = target.u
    point.v = target.v
    return true
  }
  const step = speedMmPerSec * dtSec
  if (dist <= step) {
    point.u = target.u
    point.v = target.v
    return true
  }
  point.u += (dx / dist) * step
  point.v += (dy / dist) * step
  return false
}

/**
 * Full index transition plan for sim playback.
 *
 * @returns {{
 *   preMoveToK: boolean,
 *   postMoveToK: boolean,
 *   postMoveToI: boolean,
 *   indexEndsAtTurn: boolean,
 *   side: IndexEntrySide,
 *   k: { u: number, v: number } | null,
 *   i: { u: number, v: number } | null,
 *   green: { u: number, v: number },
 *   nextCutIndex: number,
 * } | null}
 */
export function buildIndexTransitionPlan({
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

  const safety = assessIndexSafety({
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
      preMoveToK: false,
      postMoveToK: false,
      postMoveToI: false,
      indexEndsAtTurn: false,
      side: indexEntrySide(cutMode, nextCutIndex),
      k: null,
      i: null,
      green: { u: nextCutGreen.u, v: nextCutGreen.v },
      nextCutIndex,
    }
  }

  return {
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

/**
 * Attach index transition flags to every cut that has a following cut.
 *
 * @param {object} job - cut job from buildCutJob
 * @param {import('three').BufferGeometry} geometry
 * @param {object} stock
 * @param {string} cutMode
 */
export function attachIndexSafetyToJob(job, geometry, stock, cutMode) {
  if (!job?.cuts?.length || !geometry) return
  for (let i = 0; i < job.cuts.length - 1; i++) {
    job.cuts[i].indexSafety = assessIndexSafety({
      geometry,
      stock,
      rotationN: job.rotationN,
      cutMode,
      cutIndex: i,
      thetaDeg: job.cuts[i].thetaDeg,
    })
  }
}

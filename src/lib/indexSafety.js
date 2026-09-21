// Indexing (turntable turn) safety between cuts — shared by sim and G-code.
//
// When the next cut's entry K and the current cut's retract I are ordered the
// wrong way for the entry side, the wire must G0 to K before the table turns,
// then to I at the new angle, or it will slice through the foam during index.

import { CUT_MODE_LEFT_ONLY, CUT_MODE_LEFT_TO_RIGHT, effectiveCutCount } from './cutJob.js'
import { OVERLAY_COLORS, buildOverlayData } from './cutOverlay.js'
import { nextSimDot } from './simOverlay3d.js'

/** @typedef {'left' | 'right'} IndexEntrySide */

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
 * True when a pre-index wire reposition is required before turntable rotation.
 *
 * @param {IndexEntrySide} side
 * @param {number} kU - simDot / next entry U
 * @param {number} iU - red retract U
 */
export function indexSafetyNeeded(side, kU, iU) {
  if (!Number.isFinite(kU) || !Number.isFinite(iU)) return false
  if (side === 'left') return kU > iU
  return kU < iU
}

/**
 * Assess index safety for the transition from cutIndex → cutIndex + 1.
 *
 * @returns {{
 *   needed: boolean,
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
  const needed = indexSafetyNeeded(side, k.u, i.u)

  return { needed, side, k, i, nextCutIndex }
}

/**
 * Animate wire U toward a target (rapid move). Mutates `point.u`.
 *
 * @returns {boolean} true when target reached
 */
export function stepTowardU(point, targetU, speedMmPerSec, dtSec) {
  if (!point || !Number.isFinite(targetU)) return true
  const dx = targetU - point.u
  if (Math.abs(dx) < 1e-3) {
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
  if (dist < 1e-3) {
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
 * Full index transition plan for sim playback (safety + green approach target).
 *
 * @returns {{
 *   needed: boolean,
 *   preMoveToK: boolean,
 *   postMoveToI: boolean,
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
  const hasK = !!(safety?.k && Number.isFinite(safety.k.u) && Number.isFinite(safety.k.v))
  const isLeftToRight = cutMode === CUT_MODE_LEFT_TO_RIGHT

  // L-R: always rapid red → simDot (K) before every turntable turn.
  // Left-only: pre-K only when the collision condition is met.
  const preMoveToK = isLeftToRight ? hasK : !!(safety?.needed && hasK)

  return {
    needed: safety?.needed ?? false,
    preMoveToK,
    postMoveToI: safety?.needed ?? false,
    side: safety?.side ?? indexEntrySide(cutMode, nextCutIndex),
    k: safety?.k ?? null,
    i: safety?.i ?? null,
    green: { u: nextCutGreen.u, v: nextCutGreen.v },
    nextCutIndex,
  }
}

/**
 * Attach `indexSafety` to every cut that has a following cut.
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

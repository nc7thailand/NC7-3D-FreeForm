// Indexing (turntable turn) safety between cuts — shared by sim and G-code.
//
// When the next cut's entry K and the current cut's retract I are ordered the
// wrong way for the entry side, the wire must G0 to K before the table turns,
// then to I at the new angle, or it will slice through the foam during index.

import { CUT_MODE_LEFT_ONLY, effectiveCutCount } from './cutJob.js'
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
 * Attach `indexSafety` to every cut that has a following cut.
 *
 * @param {object} job - cut job from buildCutJob
 * @param {import('three').BufferGeometry} geometry
 * @param {object} stock
 * @param {string} cutMode
 */
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

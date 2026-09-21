// Orthogonal rapid moves for index sequences (500 mm/min in sim via caller speed).

export const UV_MATCH_TOL = 1e-3

/**
 * @param {{ u: number, v: number }} point
 * @param {number} targetU
 * @param {number} speedMmPerSec
 * @param {number} dtSec
 * @returns {boolean}
 */
export function stepTowardU(point, targetU, speedMmPerSec, dtSec) {
  if (!point || !Number.isFinite(targetU)) return true
  const dx = targetU - point.u
  if (Math.abs(dx) < UV_MATCH_TOL) {
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
 * @param {{ u: number, v: number }} point
 * @param {number} targetV
 * @param {number} speedMmPerSec
 * @param {number} dtSec
 * @returns {boolean}
 */
export function stepTowardV(point, targetV, speedMmPerSec, dtSec) {
  if (!point || !Number.isFinite(targetV)) return true
  const dy = targetV - point.v
  if (Math.abs(dy) < UV_MATCH_TOL) {
    point.v = targetV
    return true
  }
  const step = Math.sign(dy || 1) * speedMmPerSec * dtSec
  if (Math.abs(dy) <= Math.abs(step)) {
    point.v = targetV
    return true
  }
  point.v += step
  return false
}

/** Change V only — horizontal position fixed. */
export function stepVertical(point, targetV, speedMmPerSec, dtSec) {
  return stepTowardV(point, targetV, speedMmPerSec, dtSec)
}

/** Change U only — vertical position fixed (use at BO level). */
export function stepHorizontal(point, targetU, speedMmPerSec, dtSec) {
  return stepTowardU(point, targetU, speedMmPerSec, dtSec)
}

/**
 * Straight-line rapid (L-R index). Mutates `point`.
 *
 * @returns {boolean}
 */
export function stepTowardUV(point, target, speedMmPerSec, dtSec) {
  if (!point || !target) return true
  if (!Number.isFinite(target.u) || !Number.isFinite(target.v)) return true
  const dx = target.u - point.u
  const dy = target.v - point.v
  const dist = Math.hypot(dx, dy)
  if (dist < UV_MATCH_TOL) {
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

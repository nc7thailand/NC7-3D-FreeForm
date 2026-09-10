import { buildSectionProfile } from './toolpath.js'

/** Full silhouette covers 180° — use half the user N to avoid duplicate cuts. */
export const FULL_SILHOUETTE_HALF_SPAN = true

/**
 * @param {number} n
 * @returns {number}
 */
export function clampRotationN(n) {
  return Math.min(64, Math.max(3, Math.round(n)))
}

/**
 * Effective number of cuts for full-silhouette mode (half of user N).
 *
 * @param {number} rotationN - user-facing N (3–64)
 * @param {boolean} [halfSpan]
 * @returns {number}
 */
export function effectiveCutCount(rotationN, halfSpan = FULL_SILHOUETTE_HALF_SPAN) {
  const n = clampRotationN(rotationN)
  if (!halfSpan) return n
  return Math.max(2, Math.floor(n / 2))
}

/**
 * Build cut angles. Step spacing stays 360/N; only the count is halved (0°…180°).
 *
 * @param {number} n - user rotation N
 * @param {{ halfSpan?: boolean }} [options]
 * @returns {number[]} angles in degrees
 */
export function cutAnglesForN(n, options = {}) {
  const userN = clampRotationN(n)
  const halfSpan = options.halfSpan ?? FULL_SILHOUETTE_HALF_SPAN
  const count = halfSpan ? effectiveCutCount(userN, true) : userN
  const step = 360 / userN
  return Array.from({ length: count }, (_, i) => i * step)
}

/**
 * Compute cross-section profiles for every cut angle.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {number} rotationN - user-facing N
 * @param {THREE.Vector3} planePoint
 * @param {{ halfSpan?: boolean }} [options]
 * @returns {{ rotationN: number, cutCount: number, halfSpan: boolean, cuts: Array }}
 */
export function buildCutJob(geometry, rotationN, planePoint, options = {}) {
  const userN = clampRotationN(rotationN)
  const halfSpan = options.halfSpan ?? FULL_SILHOUETTE_HALF_SPAN
  const angles = cutAnglesForN(userN, { halfSpan })
  const cuts = angles.map((thetaDeg, index) => ({
    index,
    thetaDeg,
    profile: buildSectionProfile(geometry, thetaDeg, planePoint, null),
  }))
  return {
    rotationN: userN,
    cutCount: cuts.length,
    halfSpan,
    cuts,
  }
}

/** True when at least one cut produced a visible cross-section. */
export function cutJobHasProfile(cutJob) {
  return !!cutJob?.cuts?.some((c) => c.profile?.polylines?.length > 0)
}

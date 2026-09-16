import { buildSectionProfile } from './toolpath.js'

/**
 * Cut modes:
 *  - 'left-to-right': each of floor(N/2) cuts pairs the left silhouette at θ
 *     with its mirror (right) at θ+180°; the rotations cover the full 360° so
 *     the operator sees the whole model. Step = 360 / cutCount (45° at N=16).
 *  - 'left-only': one independent left cut per rotation, N cuts total, step 22.5°.
 */
export const CUT_MODE_LEFT_TO_RIGHT = 'left-to-right'
export const CUT_MODE_LEFT_ONLY = 'left-only'

/**
 * @param {number} n
 * @returns {number}
 */
export function clampRotationN(n) {
  return Math.min(64, Math.max(3, Math.round(n)))
}

/**
 * Effective number of cuts for a given mode.
 *  - 'left-only'     -> N cuts
 *  - 'left-to-right' -> floor(N / 2) cuts (each pairs left@θ and right@θ+180°)
 *
 * @param {number} rotationN - user-facing N (3–64)
 * @param {{ mode?: string }} [options]
 * @returns {number}
 */
export function effectiveCutCount(rotationN, options = {}) {
  const n = clampRotationN(rotationN)
  const mode = options.mode ?? CUT_MODE_LEFT_TO_RIGHT
  if (mode === CUT_MODE_LEFT_ONLY) return n
  return Math.max(2, Math.floor(n / 2))
}

/**
 * Build cut angles. The rotation step is 360 / cutCount so the cuts always
 * cover the full circle regardless of mode (left-to-right -> wider steps, full
 * model visible; left-only -> fine steps).
 *
 * @param {number} n - user rotation N
 * @param {{ mode?: string }} [options]
 * @returns {number[]} angles in degrees
 */
export function cutAnglesForN(n, options = {}) {
  const userN = clampRotationN(n)
  const count = effectiveCutCount(userN, options)
  const step = 360 / count
  return Array.from({ length: count }, (_, i) => i * step)
}

/**
 * Compute cross-section profiles for every cut angle.
 *
 * Async so a caller can paint progress between cuts: each silhouette pass is a
 * synchronous sweep over every triangle and can stall the frame on dense meshes.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {number} rotationN - user-facing N
 * @param {THREE.Vector3} planePoint
 * @param {{ mode?: string, onProgress?: (done: number, total: number) => void|Promise<void> }} [options]
 * @returns {Promise<{ rotationN: number, cutCount: number, mode: string, cuts: Array }>}
 */
export async function buildCutJob(geometry, rotationN, planePoint, options = {}) {
  const userN = clampRotationN(rotationN)
  const mode = options.mode ?? CUT_MODE_LEFT_TO_RIGHT
  const silhouetteOpts = options.silhouetteOpts ?? {}
  const angles = cutAnglesForN(userN, { mode })
  const onProgress = options.onProgress
  const cuts = []
  for (let index = 0; index < angles.length; index++) {
    const thetaDeg = angles[index]
    const profile = buildSectionProfile(geometry, thetaDeg, planePoint, null, silhouetteOpts)
    cuts.push({ index, thetaDeg, profile })
    if (onProgress) await onProgress(index + 1, angles.length)
  }
  return {
    rotationN: userN,
    cutCount: cuts.length,
    mode,
    cuts,
  }
}

/** True when at least one cut produced a visible cross-section. */
export function cutJobHasProfile(cutJob) {
  return !!cutJob?.cuts?.some((c) => c.profile?.polylines?.length > 0)
}

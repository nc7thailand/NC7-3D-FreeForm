// Indexing (turntable turn) safety between cuts — shared by sim and G-code.
//
// L-R Index Sequence logic lives in ./indexing/indexSequenceLR.js
// Left-Only Index Sequence logic lives in ./indexing/indexSequenceLeftOnly.js
// Sim playback routes via buildIndexTransitionPlan (./indexing/indexRouter.js)

import { CUT_MODE_LEFT_ONLY } from './cutJob.js'
import { assessLRIndexSafety, indexEntrySideLR } from './indexing/indexSequenceLR.js'

export {
  buildIndexTransitionPlan,
  isLeftOnlyIndexPlan,
  isLRIndexPlan,
} from './indexing/indexRouter.js'

export {
  stepTowardU,
  stepTowardUV,
  stepVertical,
  stepHorizontal,
  UV_MATCH_TOL,
} from './indexing/indexMotion.js'

export {
  indexEntrySideLR,
  kNearerCenterThanRed,
  kFartherOutThanRed,
  indexSafetyNeeded,
} from './indexing/indexSequenceLR.js'

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
  return indexEntrySideLR(nextCutIndex)
}

/**
 * Assess L-R index transition geometry for cutIndex → cutIndex + 1.
 * Left-only G-code index safety is deferred to Phase E — returns null.
 */
export function assessIndexSafety(params) {
  if (params.cutMode === CUT_MODE_LEFT_ONLY) return null
  return assessLRIndexSafety(params)
}

/**
 * Attach L-R index transition flags to every cut that has a following cut.
 * Left-only job attachment is deferred to Phase E.
 *
 * @param {object} job - cut job from buildCutJob
 * @param {import('three').BufferGeometry} geometry
 * @param {object} stock
 * @param {string} cutMode
 */
export function attachIndexSafetyToJob(job, geometry, stock, cutMode) {
  if (cutMode === CUT_MODE_LEFT_ONLY) return
  if (!job?.cuts?.length || !geometry) return
  for (let i = 0; i < job.cuts.length - 1; i++) {
    job.cuts[i].indexSafety = assessLRIndexSafety({
      geometry,
      stock,
      rotationN: job.rotationN,
      cutMode,
      cutIndex: i,
      thetaDeg: job.cuts[i].thetaDeg,
    })
  }
}

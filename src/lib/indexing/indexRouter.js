// Routes index transition planning by cut mode.

import { CUT_MODE_LEFT_ONLY, CUT_MODE_LEFT_TO_RIGHT } from '../cutJob.js'
import { buildLRIndexPlan } from './indexSequenceLR.js'
import { buildLeftOnlyIndexPlan } from './indexSequenceLeftOnly.js'

/**
 * @typedef {object} LRIndexPlan
 * @property {'left-to-right'} mode
 * @property {boolean} preMoveToK
 * @property {boolean} postMoveToK
 * @property {boolean} postMoveToI
 * @property {boolean} indexEndsAtTurn
 * @property {'left'|'right'} [side]
 * @property {{ u: number, v: number }|null} k
 * @property {{ u: number, v: number }|null} i
 * @property {{ u: number, v: number }} green
 * @property {number} nextCutIndex
 */

/**
 * @typedef {object} LeftOnlyIndexPlan
 * @property {'left-only'} mode
 * @property {number} currentCutN
 * @property {boolean} currentCutIsOdd
 * @property {number} nextCutIndex
 * @property {{ u: number, v: number }} k
 * @property {{ u: number, v: number }} i
 * @property {{ u: number, v: number }} top
 * @property {{ u: number, v: number }} axisBo
 * @property {{ u: number, v: number }} green
 * @property {'finish'|'down-to-bo-then-top'} afterRotate
 */

/** @typedef {LRIndexPlan|LeftOnlyIndexPlan} IndexTransitionPlan */

/**
 * @returns {IndexTransitionPlan|null}
 */
export function buildIndexTransitionPlan(params) {
  const { cutMode } = params
  if (cutMode === CUT_MODE_LEFT_ONLY) {
    return buildLeftOnlyIndexPlan(params)
  }
  if (cutMode === CUT_MODE_LEFT_TO_RIGHT) {
    return buildLRIndexPlan(params)
  }
  return buildLRIndexPlan(params)
}

export function isLeftOnlyIndexPlan(plan) {
  return plan?.mode === 'left-only'
}

export function isLRIndexPlan(plan) {
  return plan?.mode === 'left-to-right'
}

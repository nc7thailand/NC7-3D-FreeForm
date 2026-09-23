// Compact circular minimap — foam block top view rotates with cut angle; fixed
// 9 o'clock blue marker on the outer frame.

import {
  clampRotationN,
  cutAnglesForN,
  CUT_MODE_LEFT_TO_RIGHT,
  effectiveCutCount,
} from './cutJob.js'

export const MINIMAP_SIZE_PX = 64
export const MINIMAP_FOAM_MAX_PX = 36

/** Effective cut total shown in caption (L→R: floor(N/2)). */
export function minimapEffectiveNAll(rotationN, cutMode) {
  return effectiveCutCount(rotationN ?? 16, { mode: cutMode })
}

/** Current / effective totals for caption and rotation progress. */
export function minimapDisplayCounts(cutIndex, rotationN, cutMode) {
  const total = minimapEffectiveNAll(rotationN, cutMode)
  const current = Math.min(Math.max(0, cutIndex ?? 0) + 1, total)
  return { current, total }
}

/** Caption: `N / N all` using mode-adjusted total. */
export function minimapCaption(cutIndex, rotationN, cutMode) {
  const { current, total } = minimapDisplayCounts(cutIndex, rotationN, cutMode)
  return `${current} / ${total}`
}

/**
 * Foam block top-view rotation (deg, CCW) for the current cut θ.
 * Aligns block orientation with the fixed 9 o'clock cut reference.
 */
export function minimapFoamBlockRotationDeg(cutIndex, rotationN, cutMode) {
  const angles = cutAnglesForN(rotationN ?? 16, { mode: cutMode })
  if (!angles.length) return 0
  const idx = Math.min(Math.max(0, cutIndex ?? 0), angles.length - 1)
  return -angles[idx]
}

/**
 * Scaled W×T rectangle (top-down) to fit inside the minimap disc.
 * @returns {{ widthPx: number, heightPx: number }}
 */
export function minimapFoamBlockLayout(stock, maxPx = MINIMAP_FOAM_MAX_PX) {
  const w = Math.max(stock?.w ?? 100, 1)
  const t = Math.max(stock?.t ?? 100, 1)
  const scale = maxPx / Math.max(w, t)
  return {
    widthPx: Math.max(10, Math.round(w * scale)),
    heightPx: Math.max(8, Math.round(t * scale)),
  }
}

/** Raw user N (for modal edit) — unchanged by cut mode. */
export function minimapRawNAll(rotationN) {
  return clampRotationN(rotationN ?? 16)
}

export { CUT_MODE_LEFT_TO_RIGHT }

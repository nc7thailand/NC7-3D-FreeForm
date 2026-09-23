import { CUT_MODE_LEFT_ONLY } from './cutJob.js'
import { modelBBoxBottomY } from './toolpath.js'
import { displayCoordX, displayCoordY } from './uiAxesDisplay.js'

/**
 * Classify a direction marker for stock-field reverse mapping (UI layer only).
 *
 * @returns {'top'|'leftBottom'|'rightBottom'|null}
 */
export function classifyMarker(marker, { block, boV, cutMode }) {
  if (!marker || !block) return null
  if (cutMode === CUT_MODE_LEFT_ONLY) {
    if (Math.abs(marker.u) < 0.5 && marker.v > block.topV - 0.5) return 'top'
    return 'leftBottom'
  }
  if (Math.abs(marker.v - boV) > 0.5) return null
  if (marker.u <= block.leftU + 0.5) return 'leftBottom'
  if (marker.u >= block.rightU - 0.5) return 'rightBottom'
  return null
}

/**
 * Map a marker X/Y edit back to stock fields without touching compute core.
 *
 * @returns {Record<string, number>|null}
 */
export function stockPatchFromMarkerEdit(role, nextX, nextY, origX, origY, ctx) {
  if (!role || !ctx?.block) return null
  const patch = {}
  const xChanged = Math.abs(nextX - origX) > 1e-6
  const yChanged = Math.abs(nextY - origY) > 1e-6
  if (!xChanged && !yChanged) return null

  if (role === 'top') {
    if (yChanged) {
      patch.topOffset = Math.max(0, Math.round(nextY - (ctx.stock?.h ?? 0)))
    }
    return Object.keys(patch).length ? patch : null
  }

  const u = displayCoordX(nextX)
  const v = displayCoordY(nextY)

  if (xChanged) {
    if (role === 'leftBottom') {
      patch.boMargin = Math.max(0, Math.round(ctx.block.leftU - u))
    } else if (role === 'rightBottom') {
      patch.boMargin = Math.max(0, Math.round(u - ctx.block.rightU))
    }
  }
  if (yChanged) {
    patch.bo = Math.max(0, v - modelBBoxBottomY(ctx.geometry))
  }

  return Object.keys(patch).length ? patch : null
}

/**
 * Nudge bottom marker horizontal position by ±1 mm via boMargin.
 * @param {'leftBottom'|'rightBottom'} role
 * @param {number} boMargin
 * @param {-1|1} direction -1 = left, +1 = right
 */
export function nudgeBoMargin(role, boMargin, direction) {
  const base = boMargin ?? 0
  if (role === 'leftBottom') return Math.max(0, Math.round(base - direction))
  if (role === 'rightBottom') return Math.max(0, Math.round(base + direction))
  return Math.max(0, Math.round(base))
}

export function markerCaption(kind) {
  if (kind === 'greenDot') return 'Wire start (green)'
  if (kind === 'redDot') return 'Wire end (red)'
  return 'Direction marker'
}

/** @deprecated use markerCaption */
export const bottomMarkerCaption = markerCaption

/** Nudge top safe offset by ±1 mm. */
export function nudgeTopOffset(topOffset, direction) {
  return Math.max(0, Math.round((topOffset ?? 0) + direction))
}

/** Middle-plane u for a lower direction marker at the given boMargin. */
export function bottomMarkerU(role, block, boMargin) {
  const offset = Math.max(0, boMargin ?? 20)
  if (role === 'leftBottom') return block.leftU - offset
  if (role === 'rightBottom') return block.rightU + offset
  return 0
}

/** Middle-plane v for the top direction marker at the given topOffset. */
export function topMarkerV(stock, topOffset) {
  return (stock?.h ?? 0) + Math.max(0, topOffset ?? 20)
}

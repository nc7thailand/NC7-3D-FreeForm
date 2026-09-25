// Overlay middle-plane (u, v) → machine G-code (X, Y) using the user origin.
//
// Toolpath stock.originDisplay ('top' | 'bottom') and optional originU/originV
// place the work origin on the foam block. Every exported X/Y is relative to that
// point: G-code X = u − originU, G-code Y = v − originV.

import { resolveOriginUV } from './cutOverlay.js'

/** Foam block extents for origin resolution (same top/bottom as overlay annotations). */
export function foamBlockForOrigin(stock) {
  return {
    leftU: 0,
    rightU: 0,
    topV: stock?.h ?? 0,
    bottomV: 0,
  }
}

/** Work origin in overlay (u, v) — bottom (0,0) or top (0, H) unless overridden. */
export function gcodeOriginFromStock(stock) {
  return resolveOriginUV(foamBlockForOrigin(stock), stock) ?? { u: 0, v: 0 }
}

/** @param {{ u: number, v: number }|null|undefined} pt */
export function overlayPointToGcode(pt, origin) {
  if (!pt || !Number.isFinite(pt.u) || !Number.isFinite(pt.v)) return null
  return { x: pt.u - origin.u, y: pt.v - origin.v }
}

/** Inverse — compare G-code output back to overlay space (tests / verify). */
export function gcodePointToOverlay(x, y, origin) {
  return { u: x + origin.u, v: y + origin.v }
}

/** Human-readable origin label for G-code comments. */
export function gcodeOriginLabel(stock) {
  if (Number.isFinite(stock?.originU) || Number.isFinite(stock?.originV)) {
    return 'custom origin point'
  }
  return (stock?.originDisplay ?? 'bottom') === 'top'
    ? 'top of foam block'
    : 'bottom of foam block'
}

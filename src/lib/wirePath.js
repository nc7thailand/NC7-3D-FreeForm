// Method 1 wire-path processing: kerf compensation, BO clamp, top→bottom order.

import { blockSectionHalfWidth, effectiveBottomSafeOffset } from './toolpath.js'

/**
 * Top safe Y = H + topOffset (CONCEPT §2.3).
 *
 * @param {{ h: number, topOffset?: number }} stock
 */
export function topSafeY(stock) {
  return stock.h + (stock.topOffset ?? 20)
}

/**
 * Extend in/out X distance to foam edges (+u side).
 *
 * @param {{ w: number, t: number, lo: number }} stock
 * @param {number} thetaDeg
 */
export function extendX(stock, thetaDeg) {
  const halfW = blockSectionHalfWidth(thetaDeg, stock)
  return 2 * halfW + stock.lo
}

/**
 * Kerf compensation — wire centre sits kerf/2 left of the silhouette surface.
 *
 * @param {{ u: number, v: number }[]} polyline
 * @param {number} kerf
 */
export function applyKerf(polyline, kerf = 2) {
  const half = kerf / 2
  return polyline.map((p) => ({ u: p.u - half, v: p.v }))
}

/**
 * BO / stock clamp — keep cut path inside block bounds on the left side.
 *
 * @param {{ u: number, v: number }[]} polyline
 * @param {object} stock
 * @param {number} thetaDeg
 */
export function clampProfileToStock(polyline, stock, thetaDeg) {
  const halfW = blockSectionHalfWidth(thetaDeg, stock)
  const minU = -(halfW + stock.lo)
  const maxU = 0
  const minV = 0
  const maxV = stock.h
  return polyline.map((p) => ({
    u: Math.max(minU, Math.min(maxU, p.u)),
    v: Math.max(minV, Math.min(maxV, p.v)),
  }))
}

/**
 * Sort profile top → bottom (CONCEPT cut order).
 *
 * @param {{ u: number, v: number }[]} polyline
 */
export function orderTopDown(polyline) {
  return [...polyline].sort((a, b) => b.v - a.v || a.u - b.u)
}

function dedupePoints(pts, tol = 0.05) {
  if (pts.length < 2) return pts
  const out = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1]
    const p = pts[i]
    if (Math.hypot(p.u - prev.u, p.v - prev.v) >= tol) out.push(p)
  }
  return out
}

/**
 * Full wire-path pipeline for one cut angle.
 *
 * @param {{ u: number, v: number }[]} rawPolyline
 * @param {object} stock
 * @param {number} thetaDeg
 * @returns {{ u: number, v: number }[]}
 */
export function processWireProfile(rawPolyline, stock, thetaDeg) {
  if (!rawPolyline?.length || rawPolyline.length < 2) return []
  // Keep points in their natural contour (loop) order — do NOT sort by height,
  // which breaks the closed loop into a zig-zag "comb" of horizontal strokes.
  let pts = rawPolyline
  pts = applyKerf(pts, stock.kerf ?? 2)
  pts = clampProfileToStock(pts, stock, thetaDeg)
  return dedupePoints(pts)
}

/**
 * Bottom safe retract Y below base (LB).
 *
 * @param {object} stock
 * @param {number} thetaDeg
 */
export function bottomRetractY(stock, thetaDeg) {
  return -effectiveBottomSafeOffset(thetaDeg, stock)
}

/**
 * Process a cutJob profile object into a wire-ready polyline.
 *
 * @param {{ polylines: {u:number,v:number}[][] }} profile
 * @param {object} stock
 * @param {number} thetaDeg
 */
export function wirePathFromProfile(profile, stock, thetaDeg) {
  const raw = profile?.polylines?.[0]
  return processWireProfile(raw, stock, thetaDeg)
}

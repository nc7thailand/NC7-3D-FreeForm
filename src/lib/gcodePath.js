// Canonical middle-plane cut path for G-code — same frame as 2D / Combined overlay.
//
// Coordinates:
//   u → G-code X, v → G-code Y
//   Middle plane anchor (Z = 0), display θ reconciliation (−θ silhouette),
//   cutPath arc from buildOverlayData (matches the blue line on screen).

import { OVERLAY_COLORS, buildOverlayData } from './cutOverlay.js'

/**
 * Full overlay bundle for one cut — shared by G-code, sim stack, and UI.
 *
 * @param {object} cutJob
 * @param {{ index: number, thetaDeg: number }} cut
 * @param {{
 *   geometry?: import('three').BufferGeometry|null,
 *   stock?: object,
 *   cutMode?: string,
 * }} ctx
 */
export function overlayForCut(cutJob, cut, { geometry = null, stock, cutMode } = {}) {
  const jobStock = stock ?? cutJob?.stock ?? {}
  const mode = cutMode ?? cutJob?.mode
  return buildOverlayData({
    geometry,
    thetaDeg: cut.thetaDeg,
    stock: jobStock,
    cutMode: mode,
    cutIndex: cut.index,
    cutJob,
  })
}

/**
 * @param {object} cutJob
 * @param {{ index: number, thetaDeg: number }} cut
 * @param {Parameters<typeof overlayForCut>[2]} ctx
 * @returns {{ u: number, v: number }[]}
 */
export function overlayCutPath(cutJob, cut, ctx) {
  return overlayForCut(cutJob, cut, ctx).cutPath ?? []
}

/**
 * @param {ReturnType<typeof buildOverlayData>} overlay
 * @param {string} color
 */
export function overlayMarker(overlay, color) {
  const m = overlay?.markers?.find((mk) => mk.color === color)
  if (!m || !Number.isFinite(m.u) || !Number.isFinite(m.v)) return null
  return { u: m.u, v: m.v }
}

/** @param {ReturnType<typeof buildOverlayData>} overlay */
export function overlayGreenMarker(overlay) {
  return overlayMarker(overlay, OVERLAY_COLORS.green)
}

/** @param {ReturnType<typeof buildOverlayData>} overlay */
export function overlayRedMarker(overlay) {
  return overlayMarker(overlay, OVERLAY_COLORS.red)
}

/**
 * @typedef {{
 *   green: { u: number, v: number }|null,
 *   red: { u: number, v: number }|null,
 *   leadIn: { u: number, v: number }[],
 *   cut: { u: number, v: number }[],
 *   leadOut: { u: number, v: number }[],
 * }} CutBlockChain
 */

/**
 * One rotation block as the wire travels it: green marker → cut path → red marker.
 * The cut path is reversed when its far end is nearer the green marker (same rule
 * as the sim's buildFullWirePath), so direction follows marker parity.
 *
 * @param {ReturnType<typeof buildOverlayData>} overlay
 * @returns {CutBlockChain|null}
 */
export function cutBlockChain(overlay) {
  const path = overlay?.cutPath ?? []
  if (path.length < 2) return null
  const green = overlayGreenMarker(overlay)
  const red = overlayRedMarker(overlay)
  if (!green || !red) {
    return { green: null, red: null, leadIn: [], cut: path, leadOut: [] }
  }

  const last = path[path.length - 1]
  const distStart = Math.hypot(path[0].u - green.u, path[0].v - green.v)
  const distEnd = Math.hypot(last.u - green.u, last.v - green.v)
  const cut = distStart <= distEnd ? path : [...path].reverse()

  return {
    green,
    red,
    leadIn: [green, cut[0]],
    cut,
    leadOut: [cut[cut.length - 1], red],
  }
}

/**
 * @param {object} cutJob
 * @param {{ index: number, thetaDeg: number }} cut
 * @param {Parameters<typeof overlayForCut>[2]} ctx
 * @returns {CutBlockChain|null}
 */
export function cutBlockForCut(cutJob, cut, ctx) {
  return cutBlockChain(overlayForCut(cutJob, cut, ctx))
}

// Wire-vs-foam collision checks during turntable indexing (visualization only).

import { buildOverlayData } from './cutOverlay.js'

/**
 * True when (u, v) lies inside the projected foam block rectangle.
 *
 * @param {number} u
 * @param {number} v
 * @param {{ leftU:number, rightU:number, bottomV:number, topV:number }} block
 * @param {number} [margin=0]
 */
export function pointInFoamBlock(u, v, block, margin = 0) {
  if (!block || !Number.isFinite(u) || !Number.isFinite(v)) return false
  return u >= block.leftU - margin
    && u <= block.rightU + margin
    && v >= block.bottomV - margin
    && v <= block.topV + margin
}

/**
 * Check whether the wire marker at (wireU, wireV) intersects the foam block
 * at a given rotation angle θ.
 *
 * @param {object} opts
 * @returns {boolean}
 */
export function wireFoamCollision({
  wireU,
  wireV,
  geometry,
  stock,
  cutMode,
  cutIndex,
  thetaDeg,
  margin = 0,
}) {
  if (!geometry) return false
  const { block } = buildOverlayData({ geometry, thetaDeg, stock, cutMode, cutIndex })
  return pointInFoamBlock(wireU, wireV, block, margin)
}

// Auto foam-block sizing from the model bounding box (toolpath entry).

import { computeBoundingBox, getBoxSize } from './stl.js'

export const FOAM_SIDE_OFFSET_MM = 10
export const FOAM_BOTTOM_OFFSET_MM = 30

/**
 * Derive initial stock W/T/H from model bbox with side/top +10 mm and bottom +30 mm.
 * Model is placed 30 mm above the foam floor (base clamping clearance).
 *
 * @param {import('three').BufferGeometry} geometry
 * @returns {{ w: number, t: number, h: number, modelOffsetType: 'bottom', modelOffsetMm: number } | null}
 */
export function computeAutoFoamStockPatch(geometry) {
  if (!geometry) return null
  const size = getBoxSize(computeBoundingBox(geometry))
  return {
    w: Math.ceil(size.x + FOAM_SIDE_OFFSET_MM * 2),
    t: Math.ceil(size.z + FOAM_SIDE_OFFSET_MM * 2),
    h: Math.ceil(size.y + FOAM_SIDE_OFFSET_MM + FOAM_BOTTOM_OFFSET_MM),
    modelOffsetType: 'bottom',
    modelOffsetMm: FOAM_BOTTOM_OFFSET_MM,
  }
}

/** Merge a stock defaults object with auto foam sizing from the model bbox. */
export function buildAutoFoamStock(geometry, stockDefaults) {
  const patch = computeAutoFoamStockPatch(geometry)
  return patch ? { ...stockDefaults, ...patch } : { ...stockDefaults }
}

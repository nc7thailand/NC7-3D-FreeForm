// Vertical model placement inside the foam block (Y=0 floor … Y=H top).

/**
 * @param {import('three').BufferGeometry} geometry
 * @param {{ h?: number }} stock
 * @param {'top'|'bottom'} offsetType
 */
export function measureModelBlockOffset(geometry, stock, offsetType) {
  if (!geometry) return 0
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  if (!bb) return 0
  const h = stock?.h ?? 0
  if (offsetType === 'top') {
    return h - bb.max.y
  }
  return bb.min.y
}

/**
 * Translate geometry so the chosen anchor matches offsetMm.
 *
 * bottom: bbox.min.y = offsetMm (distance from foam floor)
 * top:    bbox.max.y = H - offsetMm (gap below foam top)
 *
 * @param {import('three').BufferGeometry} geometry
 * @param {{ h?: number }} stock
 * @param {'top'|'bottom'} offsetType
 * @param {number} offsetMm
 */
export function applyModelBlockOffset(geometry, stock, offsetType, offsetMm) {
  if (!geometry || !Number.isFinite(offsetMm)) return geometry
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  if (!bb) return geometry

  const h = stock?.h ?? 0
  let deltaY = 0
  if (offsetType === 'top') {
    deltaY = (h - offsetMm) - bb.max.y
  } else {
    deltaY = offsetMm - bb.min.y
  }

  if (Math.abs(deltaY) > 1e-6) {
    geometry.translate(0, deltaY, 0)
    geometry.computeVertexNormals()
    geometry.computeBoundingBox()
  }
  return geometry
}

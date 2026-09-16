// Shared grid-contour tracing for the toolpath silhouette.
//
// Both `silhouette.js` (toolpath geometry) and `shadowProjection.js` (3D viewer
// shadow-plane overlay) trace the boundary of a filled 2D occupancy grid to get
// the shadow contour — including concavities that a per-row min/max envelope
// cannot represent (e.g. the hollow under the horse's neck).
//
// Uses d3-contour (marching squares) — the same deterministic algorithm that
// has powered Mapbox vector-tile contours for ~10 years. Same grid + same
// threshold -> the same polyline, every time. No smoothing, no heuristics; the
// grid's "Profile accuracy" resolution is the only knob, exactly matching
// DevFoam's deterministic behaviour.
import { contours } from 'd3-contour'

/**
 * Trace the boundary (and any holes) of a filled occupancy grid via marching
 * squares (d3-contour) at iso-threshold 0.5.
 *
 * @param {Uint8Array} grid - filled occupancy grid (uBins × vBins, row-major)
 * @param {{ uMin: number, vMin: number, uStep: number, vStep: number, uBins: number, vBins: number }} spec
 * @returns {{ u: number, v: number }[]} ordered outline points of the outer contour
 */
export function traceGridBoundary(grid, spec) {
  const { uMin, vMin, uStep, vStep, uBins, vBins } = spec

  // d3-contour consumes a full Float64Array of vertex values, size([width, height]),
  // indexed [y * width + x] — which matches our [v * uBins + u] row-major layout.
  const values = new Float64Array(uBins * vBins)
  for (let i = 0; i < values.length; i++) values[i] = grid[i]

  const generator = contours()
    .size([uBins, vBins])
    .thresholds([0.5])
    .smooth(true) // linear interpolation along edges — the canonical marching-squares result

  const result = generator(values)

  // Take the largest-area outer ring (ignoring holes for the silhouette; holes
  // would matter for a later "Region" concept but the wire cuts the outer shape).
  let bestRing = null
  let bestArea = -1
  for (const contour of result) {
    const polygons = contour.coordinates
    for (const polygon of polygons) {
      const ring = polygon[0] // outer ring; polygon[1..] are holes
      if (!ring || ring.length < 3) continue
      const area = Math.abs(shoelace(ring))
      if (area > bestArea) {
        bestArea = area
        bestRing = ring
      }
    }
  }

  if (!bestRing || bestRing.length < 3) return []

  // Map grid-space coordinates (x=u, y=v) to world coordinates.
  return bestRing.map(([x, y]) => ({
    u: uMin + x * uStep,
    v: vMin + y * vStep,
  }))
}

/** Signed area of a ring of [x, y] points (grid space). */
function shoelace(ring) {
  let area = 0
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[(i + 1) % n]
    area += x0 * y1 - x1 * y0
  }
  return area / 2
}

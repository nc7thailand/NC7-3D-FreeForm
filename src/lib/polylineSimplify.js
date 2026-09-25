// Polyline reduction for raster-traced contours.
//
// The overlay contour is traced from a 1200-bin occupancy grid, so every
// sloped edge is a staircase of ~cell-sized steps. A single 1-2-1 smoothing
// pass pulls the stair corners onto the underlying edge, then Douglas–Peucker
// drops every vertex within `tolerance` of the chord — leaving vertices only
// where the shape actually bends (DevFoam-style output density).

/** Perpendicular distance from p to segment ab. */
function segmentDistance(p, a, b) {
  const du = b.u - a.u
  const dv = b.v - a.v
  const len2 = du * du + dv * dv
  let t = len2 > 0 ? ((p.u - a.u) * du + (p.v - a.v) * dv) / len2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(p.u - a.u - t * du, p.v - a.v - t * dv)
}

/**
 * Douglas–Peucker on an open polyline (iterative; endpoints always kept).
 *
 * @param {{u:number,v:number}[]} points
 * @param {number} tolerance - max allowed deviation (mm)
 */
export function simplifyOpen(points, tolerance) {
  const n = points?.length ?? 0
  if (n < 3 || !(tolerance > 0)) return points ? points.slice() : []
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack = [0, n - 1]
  while (stack.length) {
    const b = stack.pop()
    const a = stack.pop()
    let maxD = -1
    let maxI = -1
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistance(points[i], points[a], points[b])
      if (d > maxD) { maxD = d; maxI = i }
    }
    if (maxD > tolerance) {
      keep[maxI] = 1
      stack.push(a, maxI, maxI, b)
    }
  }
  const out = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i])
  return out
}

/** Drop a duplicated closing vertex (last ≈ first). */
function openRing(ring) {
  const n = ring.length
  if (n > 1) {
    const a = ring[0]
    const b = ring[n - 1]
    if (Math.abs(a.u - b.u) < 1e-9 && Math.abs(a.v - b.v) < 1e-9) return ring.slice(0, -1)
  }
  return ring
}

/** One 1-2-1 smoothing pass over a closed ring (wraps around). */
export function smoothClosed(ring) {
  const pts = openRing(ring)
  const n = pts.length
  if (n < 3) return pts.slice()
  const out = new Array(n)
  for (let i = 0; i < n; i++) {
    const p = pts[(i - 1 + n) % n]
    const c = pts[i]
    const q = pts[(i + 1) % n]
    out[i] = { u: (p.u + 2 * c.u + q.u) / 4, v: (p.v + 2 * c.v + q.v) / 4 }
  }
  return out
}

/**
 * Douglas–Peucker on a closed ring: split at vertex 0 and the vertex farthest
 * from it, simplify both halves, rejoin. Returned ring is not re-closed.
 */
export function simplifyClosed(ring, tolerance) {
  const pts = openRing(ring)
  const n = pts.length
  if (n < 4 || !(tolerance > 0)) return pts.slice()
  let far = 1
  let farD = -1
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(pts[i].u - pts[0].u, pts[i].v - pts[0].v)
    if (d > farD) { farD = d; far = i }
  }
  const first = simplifyOpen(pts.slice(0, far + 1), tolerance)
  const second = simplifyOpen([...pts.slice(far), pts[0]], tolerance)
  return [...first, ...second.slice(1, -1)]
}

/** Smooth the raster staircase, then reduce to `tolerance`. */
export function simplifyRasterContour(ring, tolerance) {
  if (!ring?.length) return []
  return simplifyClosed(smoothClosed(ring), tolerance)
}

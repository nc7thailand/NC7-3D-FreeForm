// Shared cut-overlay data for the 2D preview and the Combined 3D view.
//
// Everything here is expressed in the MIDDLE PLANE's own 2D section frame:
//   u = distance along the plane's horizontal axis (world X at every θ)
//   v = height above the plane anchor (world Y)
//
// Both consumers render the SAME numbers:
//   - SilhouettePreviewPanel maps (u, v) through its zoom/pan transform.
//   - Viewer3D maps (u, v) onto the fixed MP plane as world (u, v, 0).
//
// This module is pure arithmetic — no canvas, no THREE, no rendering.

import { densifyPolyline, extractFullSilhouette } from './silhouette.js'
import { cuttingPlane, cutBoV, planePointMiddleFromStock } from './toolpath.js'
import { CUT_MODE_LEFT_ONLY } from './cutJob.js'

// Quality is fixed at High (1200 grid bins) for the preview overlay.
export const OVERLAY_GRID_BINS = 1200
/** Max segment length when smoothing the displayed cut path (mm). */
export const OVERLAY_CUT_PATH_STEP_MM = 0.5

// Colours shared by the 2D canvas and the 3D overlay so the two views read as
// the same drawing.
export const OVERLAY_COLORS = {
  contour: '#000000',
  cutPath: '#1d5cff',
  link: '#ffffff',
  green: '#22c55e',
  greenDark: '#15803d',
  red: '#ef4444',
  redDark: '#b91c1c',
  block: '#8a9099',
  /** Model position gap — foam block floor up to model silhouette bottom. */
  modelBaseGapFill: 'rgba(239, 68, 68, 0.28)',
  /** Model position gap — model silhouette top up to foam block top (v = H). */
  modelTopGapFill: 'rgba(34, 197, 94, 0.28)',
}

/** Lowest v on the overlay silhouette — the model's bottom in section view. */
export function contourMinV(contour) {
  if (!contour?.length) return 0
  let minV = contour[0].v
  for (let i = 1; i < contour.length; i++) {
    if (contour[i].v < minV) minV = contour[i].v
  }
  return minV
}

/**
 * Rectangle (u, v) covering the foam pedestal gap under the model, clipped to
 * the stock block width. Returns null when there is no gap to show.
 */
export function modelBaseGapRect(block, contour) {
  if (!block || !contour?.length) return null
  const modelBottomV = contourMinV(contour)
  if (modelBottomV <= block.bottomV + 1e-3) return null
  return {
    leftU: block.leftU,
    rightU: block.rightU,
    bottomV: block.bottomV,
    topV: modelBottomV,
  }
}

/**
 * Rectangle (u, v) covering the clearance gap from the model silhouette top
 * up to the foam block top (v = H) — mirror of modelBaseGapRect at the top.
 * Returns null when the model already touches the foam ceiling.
 */
export function modelTopGapRect(block, contour) {
  if (!block || !contour?.length) return null
  const modelTopV = contourMaxV(contour)
  if (modelTopV >= block.topV - 1e-3) return null
  return {
    leftU: block.leftU,
    rightU: block.rightU,
    bottomV: modelTopV,
    topV: block.topV,
  }
}

/** Lowest v on the overlay silhouette — the model's top in section view. */
export function contourMaxV(contour) {
  if (!contour?.length) return 0
  let maxV = contour[0].v
  for (let i = 1; i < contour.length; i++) {
    if (contour[i].v > maxV) maxV = contour[i].v
  }
  return maxV
}

/**
 * Model-position zones for the 2D canvas.
 * Green = model top → foam block top; red = foam floor → model bottom.
 * @returns {Array<{ zoneType: 'top'|'bottom', role: string, rect: object }>}
 */
export function buildSafeZoneRegions({ block, contour }) {
  if (!block) return []
  const regions = []
  const baseGap = modelBaseGapRect(block, contour)
  if (baseGap) {
    regions.push({ zoneType: 'bottom', role: 'bottom', rect: baseGap })
  }
  const topGap = modelTopGapRect(block, contour)
  if (topGap) {
    regions.push({ zoneType: 'top', role: 'top', rect: topGap })
  }
  return regions
}

/** Lead-in / lead-out link dash shared by 2D canvas and 3D combined overlay. */
export const OVERLAY_LEAD_DASH = [5, 4]

/**
 * Interpolate where edge `a→b` crosses a constant value of `axis`.
 * Returns null when the edge does not cross (or is degenerate).
 */
function crossAt(a, b, axis, value) {
  const av = a[axis], bv = b[axis]
  if ((av - value) * (bv - value) >= 0) return null
  const t = (value - av) / (bv - av)
  return {
    u: a.u + t * (b.u - a.u),
    v: a.v + t * (b.v - a.v),
  }
}

/**
 * Build the open cut path for one rotation: the part of the closed silhouette
 * that the wire actually traces, starting and ending on the BO line (v = BO).
 *
 * The path is the arc that runs from the left-hand BO crossing, up and over the
 * top of the silhouette, to the right-hand BO crossing. The short arc under the
 * BO line is the workpiece's attachment base and is excluded. Both winding
 * directions are handled by keeping whichever arc reaches the greater height.
 *
 * In left-only mode the path walks the arc from the left BO crossing while
 * u <= 0 and stops at the APEX — the u = 0 crossing with the highest v.
 *
 * @param {{u:number,v:number}[]} contour - closed loop
 * @param {number} boV - BO level (v = BO)
 * @param {boolean} leftOnly - stop at the first u > 0 vertex
 * @returns {{u:number,v:number}[]} open polyline (empty when unavailable)
 */
export function buildCutPath(contour, boV, leftOnly) {
  const n = contour.length
  if (n < 3) return []

  const leftCross = []   // u < 0
  const rightCross = []  // u > 0
  for (let i = 0; i < n; i++) {
    const a = contour[i]
    const b = contour[(i + 1) % n]
    const p = crossAt(a, b, 'v', boV)
    if (!p) continue
    if (p.u < 0) leftCross.push({ i, ...p })
    else if (p.u > 0) rightCross.push({ i, ...p })
  }
  if (!leftCross.length || !rightCross.length) return []

  // Walk the loop from one edge-index to another, always stepping +1.
  const walk = (fromEdge, toEdge, startPt, endPt) => {
    const pts = [{ u: startPt.u, v: startPt.v }]
    let i = (fromEdge + 1) % n
    let guard = 0
    while (guard++ <= n) {
      if (i === (toEdge + 1) % n) break
      pts.push(contour[i])
      i = (i + 1) % n
    }
    pts.push({ u: endPt.u, v: endPt.v })
    return pts
  }

  let best = null
  for (const l of leftCross) {
    for (const r of rightCross) {
      const arc = walk(l.i, r.i, l, r)
      let maxV = -Infinity
      for (const p of arc) if (p.v > maxV) maxV = p.v
      if (!best || maxV > best.maxV) best = { arc, maxV }
    }
  }
  if (!best) return []

  if (!leftOnly) return best.arc

  // Left-only: the path ends at the APEX — the u = 0 crossing with the HIGHEST
  // v along the walk. Scanning the whole arc (rather than stopping at the first
  // descent) is required: the silhouette can dip between crossings when the
  // model is off-centre. If the arc never crosses u = 0, keep going to its end.
  let apexIdx = -1
  let apexV = -Infinity
  let apexPoint = null

  for (let i = 0; i < best.arc.length - 1; i++) {
    const a = best.arc[i]
    const b = best.arc[i + 1]
    if ((a.u <= 0) !== (b.u <= 0)) {
      const t = (0 - a.u) / (b.u - a.u)
      const v = a.v + t * (b.v - a.v)
      if (v > apexV + 1e-9) {
        apexV = v
        apexIdx = i
        apexPoint = { u: 0, v }
      }
    }
  }

  // No u = 0 crossing anywhere on the arc: fall back to the global-max-v vertex
  // so the path still terminates sensibly.
  if (!apexPoint) {
    let gIdx = 0
    for (let i = 1; i < best.arc.length; i++) {
      if (best.arc[i].v > best.arc[gIdx].v) gIdx = i
    }
    return best.arc.slice(0, gIdx + 1)
  }

  return [...best.arc.slice(0, apexIdx + 1), apexPoint]
}

/**
 * Extract the closed silhouette contour on the middle plane at θ.
 * Identical inputs to the 2D preview, so both views show the same loop.
 */
export function extractOverlayContour(geometry, thetaDeg) {
  if (!geometry) return []
  try {
    // DISPLAY-ONLY θ flip — see buildFullSilhouettePreview. The frame's
    // normal/uAxis assume a camera orbiting by +θ while the model physically
    // turns on a fixed wire, which mirrored the 2D/Combined drawing against
    // the 3D view at θ ≠ 0.
    const frame = cuttingPlane(-thetaDeg, planePointMiddleFromStock())
    return extractFullSilhouette(geometry, frame, {
      gridBins: OVERLAY_GRID_BINS,
    })
  } catch (err) {
    console.warn('overlay silhouette failed:', err)
    return []
  }
}

/** Projected foam-block width along the overlay's horizontal axis. */
export function projectedBlockWidth(thetaDeg, stock) {
  const rad = (thetaDeg * Math.PI) / 180
  return (stock?.w ?? 0) * Math.abs(Math.cos(rad))
    + (stock?.t ?? 0) * Math.abs(Math.sin(rad))
}

/**
 * u of the model bbox centre, projected with the same axis the silhouette uses.
 * The foam block is centred on this, not on the rotation axis.
 */
export function blockCenterU(geometry, thetaDeg) {
  if (!geometry) return 0
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  if (!bb || bb.isEmpty()) return 0
  const c = bb.getCenter(new (bb.min.constructor)())
  // DISPLAY-ONLY θ flip — must match extractOverlayContour's axis, otherwise
  // the foam block detaches from the silhouette it is drawn around.
  const uAxis = cuttingPlane(-thetaDeg, planePointMiddleFromStock()).uAxis
  return c.x * uAxis.x + c.z * uAxis.z
}

/**
 * Direction markers and link lines, in middle-plane (u, v) coordinates.
 *
 * Markers sit OUTSIDE the foam block at v = BO (left-only adds a top marker on
 * the rotation axis above the block). Links join the green marker to the cut
 * path's start and the cut path's end to the red marker. Colours swap with the
 * rotation parity, exactly as in the 2D panel.
 *
 * @returns {{
 *   block: { leftU:number, rightU:number, topV:number, bottomV:number },
 *   markers: Array<{ u:number, v:number, color:string, dark:string, size:number }>,
 *   links: Array<{ from:{u:number,v:number}, to:{u:number,v:number}, color:string }>,
 * }}
 */
export function buildOverlayAnnotations({
  cutPath, cutMode, stock, cutIndex, geometry, thetaDeg,
  boV: boVOverride, boMarginOverride, topOffsetOverride,
}) {
  const boV = boVOverride ?? cutBoV(stock, geometry)
  const projectedW = projectedBlockWidth(thetaDeg, stock)
  const uCenter = blockCenterU(geometry, thetaDeg)
  const block = {
    leftU: uCenter - projectedW / 2,
    rightU: uCenter + projectedW / 2,
    topV: stock?.h ?? 0,
    bottomV: 0,
  }

  const bottomSafeOffset = boMarginOverride ?? stock?.boMargin ?? 20
  const leftMarkerU = block.leftU - bottomSafeOffset
  const rightMarkerU = block.rightU + bottomSafeOffset
  const markerV = boV
  const MARKER_SIZE = 7

  const isOdd = (cutIndex + 1) % 2 === 1
  const GREEN = OVERLAY_COLORS.green
  const RED = OVERLAY_COLORS.red
  const GREEN_DARK = OVERLAY_COLORS.greenDark
  const RED_DARK = OVERLAY_COLORS.redDark

  const markers = []
  const links = []

  if (cutMode === CUT_MODE_LEFT_ONLY) {
    const topMarkerU = 0
    const topMarkerV = (stock?.h ?? 0) + (topOffsetOverride ?? stock?.topOffset ?? 20)

    if (cutPath.length >= 2) {
      const bottomPt = cutPath[0]
      const apexPt = cutPath[cutPath.length - 1]
      if (isOdd) {
        links.push({ from: { u: topMarkerU, v: topMarkerV }, to: apexPt, color: GREEN })
        links.push({ from: bottomPt, to: { u: leftMarkerU, v: markerV }, color: RED })
      } else {
        links.push({ from: { u: leftMarkerU, v: markerV }, to: bottomPt, color: GREEN })
        links.push({ from: apexPt, to: { u: topMarkerU, v: topMarkerV }, color: RED })
      }
    }

    markers.push({
      u: topMarkerU, v: topMarkerV, size: MARKER_SIZE,
      color: isOdd ? GREEN : RED,
      dark: isOdd ? GREEN_DARK : RED_DARK,
    })
    markers.push({
      u: leftMarkerU, v: markerV, size: MARKER_SIZE,
      color: isOdd ? RED : GREEN,
      dark: isOdd ? RED_DARK : GREEN_DARK,
    })
  } else {
    if (cutPath.length >= 2) {
      const startPt = cutPath[0]
      const endPt = cutPath[cutPath.length - 1]
      if (isOdd) {
        links.push({ from: { u: leftMarkerU, v: markerV }, to: startPt, color: GREEN })
        links.push({ from: endPt, to: { u: rightMarkerU, v: markerV }, color: RED })
      } else {
        links.push({ from: endPt, to: { u: rightMarkerU, v: markerV }, color: GREEN })
        links.push({ from: { u: leftMarkerU, v: markerV }, to: startPt, color: RED })
      }
    }

    markers.push({
      u: leftMarkerU, v: markerV, size: MARKER_SIZE,
      color: isOdd ? GREEN : RED,
      dark: isOdd ? GREEN_DARK : RED_DARK,
    })
    markers.push({
      u: rightMarkerU, v: markerV, size: MARKER_SIZE,
      color: isOdd ? RED : GREEN,
      dark: isOdd ? RED_DARK : GREEN_DARK,
    })
  }

  return { block, markers, links }
}

/**
 * Resolve origin marker position in overlay (u, v) coordinates.
 * Uses stock.originU/originV when set; otherwise block centre X and top/bottom Y.
 */
export function resolveOriginUV(block, stock) {
  if (!block) return null
  const u = Number.isFinite(stock?.originU) ? stock.originU : 0
  const v = Number.isFinite(stock?.originV)
    ? stock.originV
    : ((stock?.originDisplay ?? 'bottom') === 'top' ? block.topV : block.bottomV)
  return { u, v }
}

/** @deprecated use resolveOriginUV */
export function originMarkerUV(block, stock) {
  return resolveOriginUV(block, typeof stock === 'string' ? { originDisplay: stock } : stock)
}

/**
 * Saved overlay contour for one cut — populated at toolpath Apply time so the
 * display never re-slices the mesh when a cutJob is in memory.
 */
export function overlayContourFromCutJob(cutJob, cutIndex) {
  if (!cutJob?.cuts?.length) return null
  const cut = cutJob.cuts[Math.min(Math.max(cutIndex, 0), cutJob.cuts.length - 1)]
  const stored = cut.overlayContour ?? cut.profile?.polylines?.[0]
  return stored?.length >= 2 ? stored : null
}

/**
 * One-shot bundle of everything the overlay draws at a given θ.
 * The 2D panel and the 3D Combined view both consume this.
 *
 * When `cutJob` holds a saved contour for `cutIndex`, that contour is used
 * instead of live `extractOverlayContour(geometry, …)` — Phase 1 display path.
 */
export function buildOverlayData({
  geometry, thetaDeg, stock, cutMode, cutIndex, cutJob, boMarginOverride, topOffsetOverride,
}) {
  const storedContour = overlayContourFromCutJob(cutJob, cutIndex)
  const contour = storedContour ?? extractOverlayContour(geometry, thetaDeg)
  const boV = cutBoV(stock, geometry)
  const rawCutPath = buildCutPath(contour, boV, cutMode === CUT_MODE_LEFT_ONLY)
  const cutPath = densifyPolyline(rawCutPath, OVERLAY_CUT_PATH_STEP_MM)
  const annotations = buildOverlayAnnotations({
    cutPath, cutMode, stock, cutIndex, geometry, thetaDeg, boV,
    boMarginOverride, topOffsetOverride,
  })
  return { contour, cutPath, cutBoV: boV, ...annotations }
}

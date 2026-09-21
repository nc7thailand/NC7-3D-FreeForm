// Full-job wire simulation timeline — display overlay paths only, no G-code.
//
// Each cut lives in its own middle-plane (u, v) frame at a different θ, so a
// full job is a sequence of per-cut travels, not one concatenated polyline.

import { effectiveCutCount } from './cutJob.js'
import {
  OVERLAY_COLORS,
  buildOverlayData,
} from './cutOverlay.js'

/**
 * Cumulative arc length at each vertex of a polyline, in mm.
 *
 * @param {{u:number,v:number}[]} pts
 * @returns {number[]}
 */
export function cumulativeLengths(pts) {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].u - pts[i - 1].u, pts[i].v - pts[i - 1].v))
  }
  return cum
}

/**
 * Point at absolute arc length `distance` (mm) along a polyline.
 *
 * @param {{u:number,v:number}[]} pts
 * @param {number[]} cum
 * @param {number} distance
 */
export function pointAtDistance(pts, cum, distance) {
  if (!pts?.length) return null
  if (pts.length === 1) return { u: pts[0].u, v: pts[0].v }
  const total = cum[cum.length - 1]
  if (!isFinite(total) || !(total > 0)) return null
  if (!isFinite(distance)) return null

  const d = Math.min(total, Math.max(0, distance))
  let i = 0
  while (i < cum.length - 2 && cum[i + 1] < d) i++
  const segLen = cum[i + 1] - cum[i]
  if (!(segLen > 0)) return { u: pts[i].u, v: pts[i].v }
  const t = (d - cum[i]) / segLen
  return {
    u: pts[i].u + t * (pts[i + 1].u - pts[i].u),
    v: pts[i].v + t * (pts[i + 1].v - pts[i].v),
  }
}

/**
 * The wire's full travel for one rotation: green marker → cut path → red marker.
 *
 * @param {{u:number,v:number}[]} cutPath
 * @param {{u:number,v:number,color:string}[]} markers
 * @param {{green:string, red:string}} colors
 */
export function buildFullWirePath(cutPath, markers, colors) {
  if (!cutPath?.length) return []
  const greenMarker = markers?.find((m) => m.color === colors.green)
  const redMarker = markers?.find((m) => m.color === colors.red)
  if (!isFinite(greenMarker?.u) || !isFinite(greenMarker?.v)
    || !isFinite(redMarker?.u) || !isFinite(redMarker?.v)) {
    console.warn(
      '[sim] wire-path marker lookup failed — expected marker squares with '
      + `finite u/v for ${colors.green} and ${colors.red}.`,
    )
    return cutPath
  }

  const last = cutPath[cutPath.length - 1]
  const distStart = Math.hypot(cutPath[0].u - greenMarker.u, cutPath[0].v - greenMarker.v)
  const distEnd = Math.hypot(last.u - greenMarker.u, last.v - greenMarker.v)
  const cut = distStart <= distEnd ? cutPath : [...cutPath].reverse()

  const full = [
    { u: greenMarker.u, v: greenMarker.v },
    ...cut,
    { u: redMarker.u, v: redMarker.v },
  ]

  return full.filter((p, i) => i === 0 || Math.hypot(
    p.u - full[i - 1].u, p.v - full[i - 1].v,
  ) > 1e-6)
}

/**
 * @typedef {{
 *   cutIndex: number,
 *   thetaDeg: number,
 *   fullWirePath: {u:number,v:number}[],
 *   wireCum: number[],
 *   lengthMM: number,
 *   playable: boolean,
 * }} SimJobCut
 */

/**
 * Build one cut's wire travel from overlay geometry.
 *
 * @returns {SimJobCut}
 */
export function buildSimJobCut({ geometry, stock, cutMode, cutIndex, thetaDeg }) {
  const overlay = buildOverlayData({ geometry, thetaDeg, stock, cutMode, cutIndex })
  const fullWirePath = buildFullWirePath(overlay.cutPath, overlay.markers, OVERLAY_COLORS)
  const wireCum = cumulativeLengths(fullWirePath)
  const lengthMM = wireCum.length ? wireCum[wireCum.length - 1] : 0
  const playable = fullWirePath.length >= 2 && lengthMM > 0
  return { cutIndex, thetaDeg, fullWirePath, wireCum, lengthMM, playable }
}

/**
 * Precompute wire travels for every cut in the job.
 *
 * @param {{
 *   geometry: import('three').BufferGeometry,
 *   stock: object,
 *   cutMode: string,
 *   rotationN: number,
 *   onProgress?: (done: number, total: number) => void|Promise<void>,
 * }} opts
 * @returns {Promise<{ cuts: SimJobCut[], cutCount: number, jobTotalLengthMM: number }>}
 */
export async function buildSimJob(opts) {
  const { geometry, stock, cutMode, rotationN, onProgress } = opts
  const cutCount = effectiveCutCount(rotationN, { mode: cutMode })
  const cuts = []

  for (let cutIndex = 0; cutIndex < cutCount; cutIndex++) {
    const thetaDeg = cutCount >= 1 ? (cutIndex * 360) / cutCount : 0
    cuts.push(buildSimJobCut({ geometry, stock, cutMode, cutIndex, thetaDeg }))
    if (onProgress) await onProgress(cutIndex + 1, cutCount)
  }

  const jobTotalLengthMM = cuts.reduce(
    (sum, c) => sum + (c.playable ? c.lengthMM : 0),
    0,
  )

  return { cuts, cutCount, jobTotalLengthMM }
}

/** Sum of playable cut lengths. */
export function jobTotalLength(cuts) {
  return cuts.reduce((sum, c) => sum + (c.playable ? c.lengthMM : 0), 0)
}

/** Completed length of cuts strictly before `cutIndex`. */
export function completedLengthBefore(cuts, cutIndex) {
  let sum = 0
  for (const c of cuts) {
    if (c.cutIndex >= cutIndex) break
    if (c.playable) sum += c.lengthMM
  }
  return sum
}

/** Global job distance from per-cut position. */
export function globalDistance(cuts, cutIndex, localDist) {
  return completedLengthBefore(cuts, cutIndex) + localDist
}

/** Index of the first playable cut, or -1. */
export function firstPlayableCut(cuts) {
  const hit = cuts.find((c) => c.playable)
  return hit ? hit.cutIndex : -1
}

/** Next playable cut after `fromIndex`, or -1. */
export function nextPlayableCut(cuts, fromIndex) {
  for (let i = fromIndex + 1; i < cuts.length; i++) {
    if (cuts[i].playable) return cuts[i].cutIndex
  }
  return -1
}

/**
 * Map a job-level distance (mm) to the containing cut and local arc length.
 *
 * @param {SimJobCut[]} cuts
 * @param {number} globalDist
 * @returns {{ cutIndex: number, localDist: number, completedLength: number }|null}
 */
export function seekGlobal(cuts, globalDist) {
  const total = jobTotalLength(cuts)
  if (!(total > 0) || !cuts?.length) return null

  const g = Math.min(total, Math.max(0, globalDist))
  let walked = 0

  for (const c of cuts) {
    if (!c.playable) continue
    if (g <= walked + c.lengthMM) {
      return {
        cutIndex: c.cutIndex,
        localDist: g - walked,
        completedLength: walked,
      }
    }
    walked += c.lengthMM
  }

  const last = [...cuts].reverse().find((c) => c.playable)
  if (!last) return null
  return {
    cutIndex: last.cutIndex,
    localDist: last.lengthMM,
    completedLength: completedLengthBefore(cuts, last.cutIndex),
  }
}

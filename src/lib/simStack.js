// Build 3D world-space wire paths from a saved cut job (DevFoam sim stack).

import * as THREE from 'three'
import { unprojectFromSection } from './toolpath.js'
import { wirePathFromProfile } from './wirePath.js'

/**
 * @typedef {{ index: number, thetaDeg: number, points: THREE.Vector3[] }} WireStackPath
 */

/**
 * Convert every cut profile into kerf-compensated world points on its cutting plane.
 *
 * @param {object} cutJob
 * @returns {WireStackPath[]}
 */
export function buildWireStack(cutJob) {
  if (!cutJob?.cuts?.length) return []
  const stock = cutJob.stock ?? {}
  const paths = []

  for (const cut of cutJob.cuts) {
    if (cut.wirePath?.length >= 2) {
      paths.push({
        index: cut.index,
        thetaDeg: cut.thetaDeg,
        points: cut.wirePath.map((p) => unprojectFromSection(p, cut.profile.frame)),
      })
      continue
    }
    if (!cut.profile?.polylines?.length || !cut.profile.frame) continue
    const uv = wirePathFromProfile(cut.profile, stock, cut.thetaDeg)
    if (uv.length < 2) continue
    const points = uv.map((p) => unprojectFromSection(p, cut.profile.frame))
    paths.push({
      index: cut.index,
      thetaDeg: cut.thetaDeg,
      points,
    })
  }

  return paths
}

/**
 * Flatten stack paths into segment list for playback.
 *
 * @param {WireStackPath[]} stack
 */
export function buildPlaybackTimeline(stack) {
  const timeline = []
  for (const path of stack) {
    for (let i = 0; i < path.points.length - 1; i++) {
      timeline.push({
        cutIndex: path.index,
        segIndex: i,
        from: path.points[i],
        to: path.points[i + 1],
      })
    }
  }
  return timeline
}

/**
 * Sample playback position.
 *
 * @param {ReturnType<typeof buildPlaybackTimeline>} timeline
 * @param {number} globalSeg
 * @param {number} t
 */
export function sampleTimeline(timeline, globalSeg, t) {
  if (!timeline.length) return null
  const seg = timeline[Math.min(Math.max(globalSeg, 0), timeline.length - 1)]
  const u = Math.max(0, Math.min(1, t))
  return {
    cutIndex: seg.cutIndex,
    point: seg.from.clone().lerp(seg.to, u),
  }
}

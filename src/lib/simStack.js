// Build 3D wire paths from a saved cut job (DevFoam sim stack).
// Uses the same middle-plane overlay cutPath as the 2D visualizer and G-code.

import * as THREE from 'three'
import { layerZForCut } from './cutPathStack3d.js'
import { overlayCutPath } from './gcodePath.js'

/**
 * @typedef {{ index: number, thetaDeg: number, points: THREE.Vector3[] }} WireStackPath
 */

/**
 * Convert every cut into overlay cutPath points stacked by rotary layer (u→X, v→Y, index→Z).
 *
 * @param {object} cutJob
 * @param {import('three').BufferGeometry|null} [geometry]
 * @returns {WireStackPath[]}
 */
export function buildWireStack(cutJob, geometry = null) {
  if (!cutJob?.cuts?.length) return []
  const stock = cutJob.stock ?? {}
  const cutMode = cutJob.mode
  const geo = geometry ?? cutJob.geometry ?? null
  const ctx = { geometry: geo, stock, cutMode }
  const paths = []

  for (const cut of cutJob.cuts) {
    const uv = overlayCutPath(cutJob, cut, ctx)
    if (uv.length < 2) continue
    const layerZ = layerZForCut(cutJob, cut)
    paths.push({
      index: cut.index,
      thetaDeg: cut.thetaDeg,
      points: uv.map((p) => new THREE.Vector3(p.u, p.v, layerZ)),
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

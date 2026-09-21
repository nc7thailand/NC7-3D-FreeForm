// Method 1 G-code post-processor — G90 G21, G93 inverse time, X/Y wire + Z rotary.

import { assessIndexSafety } from './indexSafety.js'
import { extendX, topSafeY, wirePathFromProfile } from './wirePath.js'

const DEFAULT_SETTINGS = {
  feedRate: 700,
  indexFeed: 160,
  spindle: 1000,
}

export const DEFAULT_GCODE_SETTINGS = { ...DEFAULT_SETTINGS }

/**
 * G93 inverse-time feed: F = mm/min ÷ move length.
 *
 * @param {number} distanceMm
 * @param {number} feedRateMmMin
 */
export function g93Feed(distanceMm, feedRateMmMin) {
  if (distanceMm < 1e-6) return 99999
  return Math.min(99999, feedRateMmMin / distanceMm)
}

function dist3(a, b) {
  const dx = (b.x ?? a.x ?? 0) - (a.x ?? 0)
  const dy = (b.y ?? a.y ?? 0) - (a.y ?? 0)
  const dz = (b.z ?? a.z ?? 0) - (a.z ?? 0)
  return Math.hypot(dx, dy, dz)
}

function fmt(n, digits = 4) {
  return Number(n).toFixed(digits)
}

function fmtLine(prefix, move) {
  let line = prefix
  if (move.x != null) line += ` X${fmt(move.x)}`
  if (move.y != null) line += ` Y${fmt(move.y)}`
  if (move.z != null) line += ` Z${fmt(move.z)}`
  if (move.f != null) line += ` F${fmt(move.f)}`
  return line
}

/**
 * Append G1 moves with G93 feed for each segment.
 *
 * @param {string[]} lines
 * @param {GcodeMove[]} moves
 * @param {{ x: number, y: number, z: number }} pos
 * @param {number} feedRate
 */
function appendMoves(lines, moves, pos, feedRate) {
  for (const mv of moves) {
    const next = {
      x: mv.x ?? pos.x,
      y: mv.y ?? pos.y,
      z: mv.z ?? pos.z,
    }
    const d = dist3(pos, next)
    const f = mv.f ?? g93Feed(d, feedRate)
    lines.push(fmtLine('G1', { ...next, f }))
    pos.x = next.x
    pos.y = next.y
    pos.z = next.z
  }
}

/**
 * Generate Method 1 G-code for a saved cut job.
 *
 * Per cut: lead-in → profile (top→bottom) → top safe Y↑ → retract X →
 * optional index-safety XY moves → Z index → optional post-index XY → next cut.
 *
 * @param {object} cutJob
 * @param {object} [settings]
 * @returns {{ program: string, lineCount: number, cutCount: number }}
 */
export function generateGcode(cutJob, settings = {}) {
  const cfg = { ...DEFAULT_SETTINGS, ...settings }
  const stock = cutJob.stock ?? {}
  const cuts = cutJob.cuts.filter((c) => (c.wirePath?.length >= 2) || c.profile?.polylines?.length > 0)
  if (!cuts.length) {
    return { program: '; No cuts with profile\n', lineCount: 1, cutCount: 0 }
  }

  const lines = []
  lines.push('G90 G21')
  lines.push(`S${cfg.spindle}`)
  lines.push('G17')
  lines.push('G90')
  lines.push('M3')
  lines.push('G93')

  const pos = { x: 0, y: 0, z: 0 }
  const stepZ = 360 / cutJob.rotationN
  const topY = topSafeY(stock)

  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i]
    const path = cut.wirePath?.length >= 2
      ? cut.wirePath
      : wirePathFromProfile(cut.profile, stock, cut.thetaDeg)
    if (path.length < 2) continue

    const ext = extendX(stock, cut.thetaDeg)
    const leadInX = -ext
    const retractX = ext

    if (i === 0) {
      appendMoves(lines, [{ x: leadInX, y: 0, z: 0 }], pos, cfg.feedRate)
    } else {
      appendMoves(lines, [{ x: leadInX }], pos, cfg.feedRate)
    }

    appendMoves(lines, [{ x: path[0].u, y: path[0].v }], pos, cfg.feedRate)

    for (let p = 1; p < path.length; p++) {
      appendMoves(lines, [{ x: path[p].u, y: path[p].v }], pos, cfg.feedRate)
    }

    appendMoves(lines, [{ y: topY }], pos, cfg.feedRate)
    appendMoves(lines, [{ x: retractX }], pos, cfg.feedRate)

    if (i < cuts.length - 1) {
      let safety = cut.indexSafety
      if (!safety && cutJob.geometry) {
        safety = assessIndexSafety({
          geometry: cutJob.geometry,
          stock,
          rotationN: cutJob.rotationN,
          cutMode: cutJob.mode,
          cutIndex: cut.index,
          thetaDeg: cut.thetaDeg,
        })
      }

      if (safety?.preMoveToK) {
        appendMoves(lines, [{ x: safety.k.u, y: safety.k.v }], pos, cfg.feedRate)
      }

      const nextZ = cuts[i + 1].index * stepZ
      appendMoves(lines, [{ z: nextZ, f: cfg.indexFeed }], pos, cfg.feedRate)

      if (safety?.postMoveToI) {
        appendMoves(lines, [{ x: safety.i.u, y: safety.i.v }], pos, cfg.feedRate)
      } else if (safety?.postMoveToK) {
        appendMoves(lines, [{ x: safety.k.u, y: safety.k.v }], pos, cfg.feedRate)
      }
    }
  }

  lines.push('M5')
  lines.push('G30')

  const program = lines.join('\n') + '\n'
  return { program, lineCount: lines.length, cutCount: cuts.length }
}

/**
 * Trigger browser download of generated G-code.
 *
 * @param {string} program
 * @param {string} [filename]
 */
export function downloadGcode(program, filename = 'nc7-cut.nc') {
  const blob = new Blob([program], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function defaultGcodeFilename(modelName) {
  const base = (modelName || 'nc7-cut').replace(/\.(stl|nc|nc7project)$/i, '')
  return `${base}.nc`
}

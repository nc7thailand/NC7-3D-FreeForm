// Method 1 G-code post-processor — G90 G21 G94, G1 wire + rotary axis (mm/min feed).

import { OVERLAY_COLORS, buildOverlayData } from './cutOverlay.js'
import { buildIndexTransitionPlan, isLeftOnlyIndexPlan } from './indexing/indexRouter.js'
import { extendX, topSafeY, wirePathFromProfile } from './wirePath.js'

export const ROTARY_AXIS_OPTIONS = ['Z', 'A', 'B', 'C', 'U', 'V']

export const POST_PROCESS_GRBL = 'grbl'
export const POST_PROCESS_MACH3 = 'mach3'

export const POST_PROCESS_OPTIONS = [
  { value: POST_PROCESS_GRBL, label: 'GRBL', extension: 'nc' },
  { value: POST_PROCESS_MACH3, label: 'Mach3', extension: 'tap' },
]

const DEFAULT_SETTINGS = {
  feedRate: 700,
  indexFeed: 160,
  spindle: 1000,
  rotaryAxis: 'Z',
  postProcess: POST_PROCESS_GRBL,
}

export const DEFAULT_GCODE_SETTINGS = { ...DEFAULT_SETTINGS }

function fmt(n, digits = 4) {
  return Number(n).toFixed(digits)
}

/** @typedef {{ g: string|null, f: number|null, rotary: number|null }} GcodeModalState */

/**
 * Modal G1 writer — declares `G1 F…` once after M3, then omits unchanged G1,
 * rotary axis, and F on subsequent lines (1 mm rotary = 1°).
 *
 * @param {string[]} lines
 * @param {string} rotaryAxis
 * @param {number} feedRate
 * @returns {{ modal: GcodeModalState, appendMoves: Function }}
 */
function createModalWriter(lines, rotaryAxis, feedRate) {
  /** @type {GcodeModalState} */
  const modal = { g: null, f: null, rotary: null }

  lines.push(`G1 F${fmt(feedRate)}`)
  modal.g = 'G1'
  modal.f = feedRate

  /**
   * @param {GcodeMove[]} moves
   * @param {{ x: number, y: number, z: number }} pos
   * @param {number} defaultFeed
   */
  function appendMoves(moves, pos, defaultFeed) {
    for (const mv of moves) {
      const next = {
        x: mv.x ?? pos.x,
        y: mv.y ?? pos.y,
        z: mv.z ?? pos.z,
      }
      const f = mv.f ?? defaultFeed
      const parts = []

      if (modal.g !== 'G1') {
        parts.push('G1')
        modal.g = 'G1'
      }

      if (mv.x != null) parts.push(`X${fmt(next.x)}`)
      if (mv.y != null) parts.push(`Y${fmt(next.y)}`)

      const rotaryChanged = mv.z != null && next.z !== modal.rotary
      if (rotaryChanged) {
        parts.push(`${rotaryAxis}${fmt(next.z)}`)
        modal.rotary = next.z
      }

      if (f !== modal.f) {
        parts.push(`F${fmt(f)}`)
        modal.f = f
      }

      if (parts.length) lines.push(parts.join(' '))

      pos.x = next.x
      pos.y = next.y
      pos.z = next.z
    }
  }

  /**
   * G0 rapid — no F. Resets modal G so the next G1 move re-declares feed mode.
   *
   * @param {GcodeMove[]} moves
   * @param {{ x: number, y: number, z: number }} pos
   */
  function appendRapid(moves, pos) {
    for (const mv of moves) {
      const next = {
        x: mv.x ?? pos.x,
        y: mv.y ?? pos.y,
        z: mv.z ?? pos.z,
      }
      const parts = ['G0']
      modal.g = 'G0'

      if (mv.x != null) parts.push(`X${fmt(next.x)}`)
      if (mv.y != null) parts.push(`Y${fmt(next.y)}`)

      const rotaryChanged = mv.z != null && next.z !== modal.rotary
      if (rotaryChanged) {
        parts.push(`${rotaryAxis}${fmt(next.z)}`)
        modal.rotary = next.z
      }

      if (parts.length > 1) lines.push(parts.join(' '))

      pos.x = next.x
      pos.y = next.y
      pos.z = next.z
    }
  }

  return { modal, appendMoves, appendRapid }
}

/** @param {string[]} lines @param {string} text */
function pushBlockComment(lines, text) {
  lines.push(text)
}

/** @param {string[]} lines */
function pushBlockGap(lines) {
  lines.push('')
}

function greenMarkerForCut(geometry, stock, cutMode, cut) {
  if (!geometry || !cut) return null
  const { markers } = buildOverlayData({
    geometry,
    thetaDeg: cut.thetaDeg,
    stock,
    cutMode,
    cutIndex: cut.index,
  })
  const green = markers.find((m) => m.color === OVERLAY_COLORS.green)
  if (!green || !Number.isFinite(green.u) || !Number.isFinite(green.v)) return null
  return { u: green.u, v: green.v }
}

function uvNear(a, b, tol = 1e-3) {
  return Math.abs(a.u - b.u) <= tol && Math.abs(a.v - b.v) <= tol
}

/**
 * G0 rapids after rotary index — mirrors sim indexing (post-i/k, approach-green).
 *
 * @param {import('./indexing/indexRouter.js').IndexTransitionPlan|null} plan
 * @param {Function} appendRapid
 * @param {{ x: number, y: number, z: number }} pos
 * @param {object|null} nextCut
 * @param {object} stock
 */
function appendPostIndexRapids(plan, appendRapid, pos, nextCut, stock) {
  const rapidTo = (pt) => {
    if (!pt || !Number.isFinite(pt.u) || !Number.isFinite(pt.v)) return
    if (Math.abs(pos.x - pt.u) <= 1e-3 && Math.abs(pos.y - pt.v) <= 1e-3) return
    appendRapid([{ x: pt.u, y: pt.v }], pos)
  }

  if (!plan) {
    const path = nextCut?.wirePath
    if (path?.length >= 2) rapidTo({ u: path[0].u, v: path[0].v })
    else if (nextCut) {
      const ext = extendX(stock, nextCut.thetaDeg)
      appendRapid([{ x: -ext }], pos)
    }
    return
  }

  if (isLeftOnlyIndexPlan(plan)) {
    if (plan.postMoveToK && plan.k) rapidTo(plan.k)
    return
  }

  if (plan.indexEndsAtTurn) {
    rapidTo(plan.green)
    return
  }

  if (plan.postMoveToI && plan.i) {
    rapidTo(plan.i)
  } else if (plan.postMoveToK && plan.k) {
    rapidTo(plan.k)
  }

  if (plan.green && !(plan.postMoveToI && plan.i && uvNear(plan.i, plan.green))
    && !(plan.postMoveToK && plan.k && uvNear(plan.k, plan.green))) {
    rapidTo(plan.green)
  }
}

/**
 * Generate Method 1 G-code for a saved cut job.
 *
 * Per cut: lead-in → profile (top→bottom) → top safe Y↑ → retract X →
 * optional index-safety XY moves → rotary index (1 mm = 1°) → optional post-index XY → next cut.
 *
 * @param {object} cutJob
 * @param {object} [settings]
 * @param {{ geometry?: import('three').BufferGeometry|null }} [options]
 * @returns {{ program: string, lineCount: number, cutCount: number }}
 */
export function generateGcode(cutJob, settings = {}, options = {}) {
  const cfg = { ...DEFAULT_SETTINGS, ...settings }
  const rotaryAxis = ROTARY_AXIS_OPTIONS.includes(cfg.rotaryAxis) ? cfg.rotaryAxis : 'Z'
  const stock = cutJob.stock ?? {}
  const geometry = options.geometry ?? cutJob.geometry ?? null
  const cutMode = cutJob.mode
  const cuts = cutJob.cuts.filter((c) => (c.wirePath?.length >= 2) || c.profile?.polylines?.length > 0)
  if (!cuts.length) {
    return { program: '; No cuts with profile\n', lineCount: 1, cutCount: 0 }
  }

  const lines = []
  lines.push('G90 G21')
  lines.push(`S${cfg.spindle}`)
  lines.push('G17')
  lines.push('G94')
  lines.push('M3')

  const pos = { x: 0, y: 0, z: 0 }
  const { appendMoves, appendRapid } = createModalWriter(lines, rotaryAxis, cfg.feedRate)
  const stepRotary = 360 / cutJob.rotationN
  const topY = topSafeY(stock)

  const rotationTotal = cuts.length

  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i]
    const path = cut.wirePath?.length >= 2
      ? cut.wirePath
      : wirePathFromProfile(cut.profile, stock, cut.thetaDeg)
    if (path.length < 2) continue

    const ext = extendX(stock, cut.thetaDeg)
    const leadInX = -ext
    const retractX = ext
    const rotationNumber = i + 1

    pushBlockComment(lines, '//start block')
    pushBlockComment(lines, `// Rotation Number ${rotationNumber}/${rotationTotal}`)
    pushBlockGap(lines)

    if (i === 0) {
      appendMoves([{ x: leadInX, y: 0, z: 0 }], pos, cfg.feedRate)
    } else {
      appendMoves([{ x: leadInX }], pos, cfg.feedRate)
    }

    appendMoves([{ x: path[0].u, y: path[0].v }], pos, cfg.feedRate)

    for (let p = 1; p < path.length; p++) {
      appendMoves([{ x: path[p].u, y: path[p].v }], pos, cfg.feedRate)
    }

    appendMoves([{ y: topY }], pos, cfg.feedRate)
    appendMoves([{ x: retractX }], pos, cfg.feedRate)

    pushBlockGap(lines)
    pushBlockComment(lines, `// End Of Rotation Number ${rotationNumber}/${rotationTotal}`)
    pushBlockGap(lines)

    if (i < cuts.length - 1) {
      const nextCut = cuts[i + 1]
      const nextGreen = greenMarkerForCut(geometry, stock, cutMode, nextCut)
      const indexPlan = geometry
        ? buildIndexTransitionPlan({
          geometry,
          stock,
          rotationN: cutJob.rotationN,
          cutMode,
          cutIndex: cut.index,
          thetaDeg: cut.thetaDeg,
          nextCutGreen: nextGreen,
        })
        : null

      pushBlockComment(lines, '// move rotary axis')
      pushBlockGap(lines)

      if (indexPlan?.preMoveToK && indexPlan.k) {
        appendRapid([{ x: indexPlan.k.u, y: indexPlan.k.v }], pos)
      }

      const nextRotary = nextCut.index * stepRotary
      appendMoves([{ z: nextRotary, f: cfg.indexFeed }], pos, cfg.feedRate)

      appendPostIndexRapids(indexPlan, appendRapid, pos, nextCut, stock)

      pushBlockGap(lines)
    }

    pushBlockComment(lines, '//End of block')
    pushBlockGap(lines)
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

/** @param {string} [postProcess] */
export function gcodeFileExtension(postProcess) {
  const match = POST_PROCESS_OPTIONS.find((o) => o.value === postProcess)
  return match?.extension ?? 'nc'
}

/** @param {string} [modelName] @param {string} [postProcess] */
export function defaultGcodeFilename(modelName, postProcess = POST_PROCESS_GRBL) {
  const base = (modelName || 'nc7-cut').replace(/\.(stl|nc|tap|nc7project)$/i, '')
  return `${base}.${gcodeFileExtension(postProcess)}`
}

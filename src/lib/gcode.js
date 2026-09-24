// Method 1 G-code post-processor — G90 G21 G94, G1 wire + rotary axis (mm/min feed).

import { buildIndexTransitionPlan, isLeftOnlyIndexPlan, isLRIndexPlan } from './indexing/indexRouter.js'
import { cutBlockForCut } from './gcodePath.js'
import { extendX, topSafeY } from './wirePath.js'

export const ROTARY_AXIS_OPTIONS = ['Z', 'A', 'B', 'C', 'U', 'V']

export const POST_PROCESS_GRBL = 'grbl'
export const POST_PROCESS_MACH3 = 'mach3'

export const POST_PROCESS_OPTIONS = [
  { value: POST_PROCESS_GRBL, label: 'GRBL', extension: 'nc' },
  { value: POST_PROCESS_MACH3, label: 'Mach3', extension: 'tap' },
]

export const INDEX_MOTION_G1 = 'G1'
export const INDEX_MOTION_G0 = 'G0'

const DEFAULT_SETTINGS = {
  feedRate: 700,
  indexMotion: INDEX_MOTION_G0,
  indexFeed: 160,
  spindle: 1000,
  rotaryAxis: 'Z',
  postProcess: POST_PROCESS_GRBL,
}

export const DEFAULT_GCODE_SETTINGS = { ...DEFAULT_SETTINGS }

function fmt(n, digits = 4) {
  return Number(n).toFixed(digits)
}

/** Remove nested parens — RS-274 comments cannot contain ( or ). */
function sanitizeCommentText(text) {
  return String(text).replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Standard CNC / RS-274 whole-line or inline comment. */
function parenComment(text) {
  const body = sanitizeCommentText(text)
  return body ? `(${body})` : '()'
}

/** Marlin-style whole-line comment (Mach3; GRBL stock firmware ignores `;` as comment). */
function semiComment(text) {
  return `; ${sanitizeCommentText(text)}`
}

/**
 * Post-processor-aware comment formatter.
 * GRBL: parentheses only. Mach3: parentheses for blocks, semicolon for brief line notes.
 *
 * @param {string} [postProcess]
 */
function createCommentFormatter(postProcess = POST_PROCESS_GRBL) {
  const isMach3 = postProcess === POST_PROCESS_MACH3
  const postLabel = POST_PROCESS_OPTIONS.find((o) => o.value === postProcess)?.label ?? 'GRBL'

  return {
    postLabel,
    /** Section / block headers — always `( )` for GRBL and Mach3. */
    block(text) {
      return parenComment(text)
    },
    /** Operational whole-line note — `;` on Mach3, `( )` on GRBL. */
    line(text) {
      return isMach3 ? semiComment(text) : parenComment(text)
    },
    /** Inline suffix on a move line, e.g. `G1 F700 (Cut feed mm/min)`. */
    inline(text) {
      return parenComment(text)
    },
  }
}

/** @typedef {{ g: string|null, f: number|null, rotary: number|null }} GcodeModalState */

/**
 * Modal G1 writer — declares `G1 F…` once after M3, then omits unchanged G1,
 * rotary axis, and F on subsequent lines (1 mm rotary = 1°).
 *
 * @param {string[]} lines
 * @param {string} rotaryAxis
 * @param {number} feedRate
 * @param {string} [firstLineNote] inline `( )` comment on the initial feed line
 * @returns {{ modal: GcodeModalState, appendMoves: Function }}
 */
function createModalWriter(lines, rotaryAxis, feedRate, firstLineNote = '') {
  /** @type {GcodeModalState} */
  const modal = { g: null, f: null, rotary: null }

  const feedLine = `G1 F${fmt(feedRate)}`
  lines.push(firstLineNote ? `${feedLine} ${firstLineNote}` : feedLine)
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

  /**
   * Force G1 + F on the first move — required after every G0 transition block.
   *
   * @param {GcodeMove[]} moves
   * @param {{ x: number, y: number, z: number }} pos
   * @param {number} defaultFeed
   */
  function appendMovesWithModalReset(moves, pos, defaultFeed) {
    if (!moves.length) return
    const [first, ...rest] = moves
    const next = {
      x: first.x ?? pos.x,
      y: first.y ?? pos.y,
      z: first.z ?? pos.z,
    }
    const f = first.f ?? defaultFeed
    const parts = ['G1']
    modal.g = 'G1'

    if (first.x != null) parts.push(`X${fmt(next.x)}`)
    if (first.y != null) parts.push(`Y${fmt(next.y)}`)

    const rotaryChanged = first.z != null && next.z !== modal.rotary
    if (rotaryChanged) {
      parts.push(`${rotaryAxis}${fmt(next.z)}`)
      modal.rotary = next.z
    }

    parts.push(`F${fmt(f)}`)
    modal.f = f
    lines.push(parts.join(' '))

    pos.x = next.x
    pos.y = next.y
    pos.z = next.z

    if (rest.length) appendMoves(rest, pos, defaultFeed)
  }

  return { modal, appendMoves, appendRapid, appendMovesWithModalReset }
}

/** @param {string[]} lines */
function pushBlockGap(lines) {
  lines.push('')
}

/** Shared overlay context for every cut in one program. */
function overlayCtx(cutJob, geometry) {
  return {
    geometry,
    stock: cutJob.stock ?? {},
    cutMode: cutJob.mode,
  }
}

/**
 * Transition between rotation blocks. The wire leaves the block at the red marker.
 * With an index plan (left-only or left-to-right) it follows the markers at the
 * same level — see appendMarkerTransition. Without one (no geometry) it falls
 * back to: up to top safe Y, rotary index, across, down to the next green marker.
 *
 * @param {object} params
 */
function appendTransitionBlock({
  lines,
  cmt,
  appendRapid,
  appendIndex,
  pos,
  indexPlan,
  safeY,
  nextRotary,
  nextGreen,
  fallbackStart,
}) {
  lines.push(cmt.line('Move rotary axis'))
  pushBlockGap(lines)

  const target = nextGreen ?? fallbackStart

  if (isLeftOnlyIndexPlan(indexPlan) || isLRIndexPlan(indexPlan)) {
    appendMarkerTransition({
      lines, cmt, appendRapid, appendIndex, pos, indexPlan, nextRotary, target,
    })
    return
  }

  lines.push(cmt.line('Rapid up from red marker to top safe Y before turn'))
  appendRapid([{ x: pos.x, y: safeY }], pos)

  lines.push(cmt.line(`Rotary index to ${nextRotary.toFixed(4)} deg equivalent`))
  appendIndex(nextRotary)

  lines.push(cmt.line('Rapid reposition after index to next green marker'))
  if (target && Math.abs(pos.x - target.u) > 1e-6) {
    appendRapid([{ x: target.u, y: safeY }], pos)
  }
  if (target) {
    appendRapid([{ x: target.u, y: target.v }], pos)
  }
}

/**
 * Marker-following transition — the wire stays at the level it left the block
 * and never climbs to safe Y (left-only: lower-left BO after Odd N, TOP after
 * Even N; left-to-right: bottom BO on the red/next-green side).
 *   preMoveToK:  G0 red → simDot K, turn
 *   otherwise:   turn at red, G0 → K (next green)
 */
function appendMarkerTransition({
  lines, cmt, appendRapid, appendIndex, pos, indexPlan, nextRotary, target,
}) {
  const k = indexPlan.k ?? target
  if (indexPlan.preMoveToK && k) {
    lines.push(cmt.line('Rapid from red marker to simDot K before turn'))
    appendRapid([{ x: k.u, y: k.v }], pos)
  }

  lines.push(cmt.line(`Rotary index to ${nextRotary.toFixed(4)} deg equivalent`))
  appendIndex(nextRotary)

  if (target) {
    lines.push(cmt.line('Rapid to next green marker'))
    appendRapid([{ x: target.u, y: target.v }], pos)
  }
}

/**
 * Generate Method 1 G-code for a saved cut job.
 *
 * Per cut: green marker → lead-in → overlay cut path → lead-out → red marker →
 * index transition (1 mm = 1°) → next cut's green marker.
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
  const ctx = overlayCtx(cutJob, geometry)
  const cuts = cutJob.cuts.filter(
    (c) => c.overlayContour?.length >= 2 || c.profile?.polylines?.length > 0,
  )
  const cmt = createCommentFormatter(cfg.postProcess)
  if (!cuts.length) {
    return { program: `${cmt.block('No cuts with profile')}\n`, lineCount: 1, cutCount: 0 }
  }

  const lines = []
  lines.push(cmt.block('NC7 Studio3D - Method 1 G1'))
  lines.push(cmt.block(`Post processor: ${cmt.postLabel}`))
  lines.push(cmt.block('Units: millimeters, absolute G90, feed G94 mm/min'))
  lines.push(cmt.block(`Rotary axis: ${rotaryAxis}, 1 mm = 1 degree`))
  lines.push(cmt.block(`Total rotations: ${cuts.length}, N=${cutJob.rotationN}`))
  pushBlockGap(lines)
  lines.push(cmt.block('Program start'))
  lines.push('G90 G21')
  lines.push(`S${cfg.spindle}`)
  lines.push('G17')
  lines.push('G94')
  lines.push('M3')

  const pos = { x: 0, y: 0, z: 0 }
  const { appendMoves, appendRapid, appendMovesWithModalReset } = createModalWriter(
    lines,
    rotaryAxis,
    cfg.feedRate,
    cmt.inline('Cut feed mm/min'),
  )
  const stepRotary = 360 / cutJob.rotationN
  const topY = topSafeY(stock)
  const appendIndex = cfg.indexMotion === INDEX_MOTION_G0
    ? (z) => appendRapid([{ z }], pos)
    : (z) => appendMoves([{ z, f: cfg.indexFeed }], pos, cfg.feedRate)

  const rotationTotal = cuts.length

  const blocks = cuts.map((cut) => cutBlockForCut(cutJob, cut, ctx))

  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i]
    const block = blocks[i]
    if (!block || block.cut.length < 2) continue
    const path = block.cut
    const rotationNumber = i + 1

    lines.push(cmt.block(`Start block - Rotation Number ${rotationNumber}/${rotationTotal}`))
    lines.push(cmt.block(`Cut angle ${cut.thetaDeg.toFixed(1)} deg`))
    pushBlockGap(lines)

    if (i === 0 && block.green) {
      lines.push(cmt.line('Move to wire start - green marker'))
      appendMovesWithModalReset(
        [{ x: block.green.u, y: block.green.v, z: 0 }],
        pos,
        cfg.feedRate,
      )
      lines.push(cmt.line('Lead-in from green marker'))
      appendMoves([{ x: path[0].u, y: path[0].v }], pos, cfg.feedRate)
    } else {
      lines.push(cmt.line(block.green ? 'Lead-in from green marker' : 'Move to cut start'))
      appendMovesWithModalReset(
        [{ x: path[0].u, y: path[0].v, ...(i === 0 ? { z: 0 } : {}) }],
        pos,
        cfg.feedRate,
      )
    }

    lines.push(cmt.line('Toolpath pass - overlay cut path'))
    for (let p = 1; p < path.length; p++) {
      appendMoves([{ x: path[p].u, y: path[p].v }], pos, cfg.feedRate)
    }

    if (block.red) {
      lines.push(cmt.line('Lead-out to red marker'))
      appendMoves([{ x: block.red.u, y: block.red.v }], pos, cfg.feedRate)
    }

    pushBlockGap(lines)
    lines.push(cmt.block(`End of rotation number ${rotationNumber}/${rotationTotal}`))
    pushBlockGap(lines)

    if (i < cuts.length - 1) {
      const nextCut = cuts[i + 1]
      const nextBlock = blocks[i + 1]
      const nextGreen = nextBlock?.green ?? null
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

      appendTransitionBlock({
        lines,
        cmt,
        appendRapid,
        appendIndex,
        pos,
        indexPlan,
        safeY: topY,
        nextRotary: nextCut.index * stepRotary,
        nextGreen,
        fallbackStart: nextBlock?.cut?.[0] ?? { u: -extendX(stock, nextCut.thetaDeg), v: topY },
      })

      pushBlockGap(lines)
    }

    lines.push(cmt.block('End of block'))
    pushBlockGap(lines)
  }

  pushBlockGap(lines)
  lines.push(cmt.block('Program end - spindle stop and home'))
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

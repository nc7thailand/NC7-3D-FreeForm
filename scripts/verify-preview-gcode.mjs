// Verifies the G-code program and the 3D preview layer stack describe the same
// wire path: per rotation block, green marker → lead-in → cut → lead-out → red
// marker, at the rotary value the preview stacks the layer on.
//
// Usage: node scripts/verify-preview-gcode.mjs
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { orientGeometryUp } from '../src/lib/stl.js'
import { planePointFromStock } from '../src/lib/toolpath.js'
import { buildCutJob, CUT_MODE_LEFT_TO_RIGHT, CUT_MODE_LEFT_ONLY } from '../src/lib/cutJob.js'
import { extractOverlayContour } from '../src/lib/cutOverlay.js'
import { attachIndexSafetyToJob } from '../src/lib/indexSafety.js'
import { generateGcode, DEFAULT_GCODE_SETTINGS } from '../src/lib/gcode.js'
import { buildCutPathLayerStack, PREVIEW_VIEW } from '../src/lib/cutPathStack3d.js'

const TOL = 1e-3
const STL = 'Example/DevFoamExample/Preview.stl'
const STOCK = {
  w: 400, t: 400, h: 650, lo: 5, bo: 1, kerf: 2,
  topOffset: 20, boAuto: true, boMargin: 20,
  showModelBBox: true, profileAccuracy: 5,
}

function parseSTL(buf) {
  const tc = buf.readUInt32LE(80)
  const positions = new Float32Array(tc * 9)
  const index = new Uint32Array(tc * 3)
  let off = 84
  for (let t = 0; t < tc; t++) {
    off += 12
    for (let k = 0; k < 3; k++) {
      positions[t * 9 + k * 3 + 0] = buf.readFloatLE(off)
      positions[t * 9 + k * 3 + 1] = buf.readFloatLE(off + 4)
      positions[t * 9 + k * 3 + 2] = buf.readFloatLE(off + 8)
      index[t * 3 + k] = t * 3 + k
      off += 12
    }
    off += 2
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setIndex(new THREE.BufferAttribute(index, 1))
  return g
}

function loadGeometry() {
  const geo = orientGeometryUp(parseSTL(readFileSync(STL)))
  geo.computeBoundingBox()
  const c = geo.boundingBox.getCenter(new THREE.Vector3())
  geo.translate(-c.x, -c.y, -c.z)
  geo.computeBoundingBox()
  geo.translate(0, -geo.boundingBox.min.y, 0)
  geo.computeBoundingBox()
  return geo
}

/**
 * Modal interpreter. Returns per-block G1 XY feed moves, the position right
 * before each block's first feed move, the rotary value inside the block, and
 * any G1 XY moves found outside blocks.
 */
function interpretProgram(program, rotaryAxis) {
  const pos = { x: 0, y: 0, r: 0 }
  let g = 'G1'
  const blocks = []
  let current = null
  const strayFeeds = []
  /** transitions[k] = rapids between block k and k+1: { from, to, r } */
  const transitions = []
  let transition = null

  for (const raw of program.split('\n')) {
    const startMatch = raw.match(/Start block - Rotation Number (\d+)\//)
    if (startMatch) {
      current = { number: Number(startMatch[1]), feeds: [], entry: null, rotary: new Set() }
      blocks.push(current)
      transition = null
      continue
    }
    if (/End of rotation number/.test(raw)) {
      current = null
      transition = []
      transitions.push(transition)
      continue
    }
    const code = raw.replace(/\(.*?\)/g, '').replace(/;.*$/, '').trim()
    if (!code) continue

    const gm = code.match(/\bG0?([01])\b/)
    if (gm) g = gm[1] === '0' ? 'G0' : 'G1'
    const x = code.match(/X(-?\d+(?:\.\d+)?)/)
    const y = code.match(/Y(-?\d+(?:\.\d+)?)/)
    const r = code.match(new RegExp(`${rotaryAxis}(-?\\d+(?:\\.\\d+)?)`))
    if (!x && !y && !r) continue

    const before = { x: pos.x, y: pos.y, r: pos.r }
    if (x) pos.x = Number(x[1])
    if (y) pos.y = Number(y[1])
    if (r) pos.r = Number(r[1])
    const movesXY = !!(x || y)

    if (transition && r && !near(pos.r, before.r)) {
      transition.push({
        type: 'rotary', g, at: { u: before.x, v: before.y }, from: before.r, to: pos.r, movesXY,
        feed: code.match(/F(-?\d+(?:\.\d+)?)/)?.[1],
      })
    }

    if (g === 'G0' && movesXY && transition) {
      const dist = Math.hypot(pos.x - before.x, pos.y - before.y)
      if (dist > TOL) {
        transition.push({ type: 'rapid', from: { u: before.x, v: before.y }, to: { u: pos.x, v: pos.y }, r: pos.r })
      }
    }

    if (g === 'G1' && movesXY) {
      if (current) {
        if (!current.feeds.length) current.entry = before
        current.feeds.push({ u: pos.x, v: pos.y })
        current.rotary.add(pos.r)
      } else {
        strayFeeds.push(raw)
      }
    }
  }
  return { blocks, strayFeeds, transitions }
}

/**
 * Every rapid between blocks must be the yellow simDot link drawn in the
 * preview (same endpoints, same layer), the wire never climbs, and the single
 * rotary index must be the white rotary link (same XY, layer N → N+1) using
 * the selected index motion.
 */
function verifyTransitions(layers, transitions, settings, fail) {
  let linksChecked = 0
  let rotaryChecked = 0
  for (let k = 0; k < layers.length - 1; k++) {
    const layer = layers[k]
    const next = layers[k + 1]
    const events = transitions[k] ?? []
    const rapids = events.filter((e) => e.type === 'rapid')
    const rotaries = events.filter((e) => e.type === 'rotary')
    const tag = `transition ${k + 1}→${k + 2}`
    const maxV = Math.max(layer.chain.red.v, next.chain.green.v)

    const link = layer.rotaryLink
    if (!link) {
      fail(`${tag}: no white rotary link in the preview`)
    } else if (rotaries.length !== 1) {
      fail(`${tag}: expected 1 rotary index, found ${rotaries.length}`)
    } else {
      const rot = rotaries[0]
      const [a, b] = link
      const okXY = near(rot.at.u, a.x) && near(rot.at.v, a.y) && near(b.x, a.x) && near(b.y, a.y)
      const okZ = near(rot.from, a.z) && near(rot.to, b.z)
      const wantG = settings.indexMotion ?? 'G1'
      const okMotion = rot.g === wantG && !rot.movesXY
        && (wantG === 'G0' ? rot.feed == null : near(Number(rot.feed), settings.indexFeed))
      if (!okXY || !okZ) {
        fail(`${tag}: rotary at (${rot.at.u},${rot.at.v}) ${rot.from}→${rot.to} ≠ white link (${a.x.toFixed(4)},${a.y.toFixed(4)}) ${a.z}→${b.z}`)
      }
      if (!okMotion) {
        fail(`${tag}: rotary emitted as ${rot.g}${rot.feed ? ` F${rot.feed}` : ''}, expected ${wantG}`)
      }
      if (okXY && okZ && okMotion) rotaryChecked += 1
    }

    for (const mv of rapids) {
      if (mv.to.v > maxV + TOL) {
        fail(`${tag}: rapid climbs to Y${mv.to.v} (red Y${layer.chain.red.v}, next green Y${next.chain.green.v})`)
      }
    }

    const owner = [layer, next].find((l) => l.simDotLinks.some((s) => s.fromIndex === layer.index))
    if (!owner) {
      if (rapids.length) fail(`${tag}: ${rapids.length} rapid(s) with no simDot link in the preview`)
      continue
    }
    const [a, b] = owner.simDotLinks.find((s) => s.fromIndex === layer.index).points
    if (rapids.length !== 1) {
      fail(`${tag}: expected 1 rapid red → simDot, found ${rapids.length}`)
      continue
    }
    const mv = rapids[0]
    const ok = near(mv.from.u, a.x) && near(mv.from.v, a.y)
      && near(mv.to.u, b.x) && near(mv.to.v, b.y)
      && near(mv.r, owner.layerZ)
    if (!ok) {
      fail(`${tag}: rapid (${mv.from.u},${mv.from.v})→(${mv.to.u},${mv.to.v}) @${mv.r} ≠ link (${a.x.toFixed(4)},${a.y.toFixed(4)})→(${b.x.toFixed(4)},${b.y.toFixed(4)}) @${owner.layerZ}`)
    }
    if (!nearUV({ u: b.x, v: b.y }, next.chain.green)) {
      fail(`${tag}: simDot K is not the next green marker`)
    }
    linksChecked += 1
  }
  return { linksChecked, rotaryChecked }
}

const near = (a, b) => Math.abs(a - b) <= TOL
const nearUV = (a, b) => near(a.u, b.u) && near(a.v, b.v)

function verifyMode(label, mode, geo, job, settingsPatch = {}) {
  const errors = []
  const fail = (msg) => { if (errors.length < 20) errors.push(msg) }

  const cutJob = { ...job, stock: STOCK, mode }
  const settings = { ...DEFAULT_GCODE_SETTINGS, ...settingsPatch }
  const { program } = generateGcode(cutJob, settings, { geometry: geo })
  const rotaryAxis = settings.rotaryAxis ?? 'Z'
  const { blocks, strayFeeds, transitions } = interpretProgram(program, rotaryAxis)

  const stack = buildCutPathLayerStack(cutJob, geo, { viewMode: PREVIEW_VIEW.STACK })
  const assembled = buildCutPathLayerStack(cutJob, geo, { viewMode: PREVIEW_VIEW.ASSEMBLED })

  if (blocks.length !== stack.layers.length) {
    fail(`block count ${blocks.length} ≠ preview layer count ${stack.layers.length}`)
  }
  if (assembled.layers.length !== stack.layers.length) {
    fail(`assembled layer count ${assembled.layers.length} ≠ stack ${stack.layers.length}`)
  }
  if (strayFeeds.length) {
    fail(`${strayFeeds.length} G1 XY feed move(s) outside rotation blocks, e.g. "${strayFeeds[0]}"`)
  }

  let comparedPoints = 0
  const n = Math.min(blocks.length, stack.layers.length)
  for (let k = 0; k < n; k++) {
    const block = blocks[k]
    const layer = stack.layers[k]
    const { green, red, cut } = layer.chain
    const tag = `block ${k + 1} (θ=${layer.thetaDeg.toFixed(1)}°)`

    if (!green || !red) {
      fail(`${tag}: preview chain has no green/red marker`)
      continue
    }

    // Stack-view geometry must be exactly the chain on Z = layerZ.
    const previewPath = [...layer.leadIn, ...layer.cut.slice(1), layer.leadOut[1]]
    const chainPath = [green, ...cut, red]
    if (previewPath.length !== chainPath.length) {
      fail(`${tag}: preview polyline length ${previewPath.length} ≠ chain ${chainPath.length}`)
    }
    previewPath.forEach((p, i) => {
      const c = chainPath[i]
      if (!c || !near(p.x, c.u) || !near(p.y, c.v) || !near(p.z, layer.layerZ)) {
        fail(`${tag}: preview point ${i} mismatch`)
      }
    })

    // G-code: block 0 feeds green → cut → red; later blocks enter at green via G0.
    const expected = k === 0 ? chainPath : [...cut, red]
    if (k > 0) {
      if (!block.entry || !nearUV({ u: block.entry.x, v: block.entry.y }, green)) {
        fail(`${tag}: G0 approach ends at (${block.entry?.x}, ${block.entry?.y}), green marker is (${green.u.toFixed(4)}, ${green.v.toFixed(4)})`)
      }
    }
    if (block.feeds.length !== expected.length) {
      fail(`${tag}: G-code feed count ${block.feeds.length} ≠ expected ${expected.length}`)
    }
    const m = Math.min(block.feeds.length, expected.length)
    for (let i = 0; i < m; i++) {
      if (!nearUV(block.feeds[i], expected[i])) {
        fail(`${tag}: feed ${i} G-code (${block.feeds[i].u}, ${block.feeds[i].v}) ≠ preview (${expected[i].u.toFixed(4)}, ${expected[i].v.toFixed(4)})`)
        break
      }
      comparedPoints += 1
    }

    const rotary = [...block.rotary]
    if (rotary.length !== 1 || !near(rotary[0], layer.layerZ)) {
      fail(`${tag}: rotary ${rotary.join(',')} ≠ preview layerZ ${layer.layerZ}`)
    }
  }

  const transitionStats = verifyTransitions(stack.layers, transitions, settings, fail)

  return { label, blocks: blocks.length, layers: stack.layers.length, comparedPoints, transitionStats, errors }
}

async function main() {
  const geo = loadGeometry()
  const planePoint = planePointFromStock(STOCK)
  const modes = [
    ['left-to-right', CUT_MODE_LEFT_TO_RIGHT],
    ['left-only', CUT_MODE_LEFT_ONLY],
  ]

  let failed = false
  for (const [label, mode] of modes) {
    const job = await buildCutJob(geo, 16, planePoint, {
      mode,
      silhouetteOpts: { profileAccuracy: 5 },
    })
    job.stock = { ...STOCK }
    for (const cut of job.cuts) {
      cut.overlayContour = extractOverlayContour(geo, cut.thetaDeg)
    }
    attachIndexSafetyToJob(job, geo, STOCK, mode)

    const variants = [['index G0', { indexMotion: 'G0' }], ['index G1', { indexMotion: 'G1' }]]
    for (const [variant, patch] of variants) {
      const r = verifyMode(label, mode, geo, job, patch)
      const status = r.errors.length ? 'FAIL' : 'PASS'
      const t = r.transitionStats
      const extra = t ? `, ${t.linksChecked} yellow X-rapid links, ${t.rotaryChecked} white rotary links matched` : ''
      console.log(`[${status}] ${r.label} (${variant}): ${r.blocks} G-code blocks, ${r.layers} preview layers, ${r.comparedPoints} points matched${extra}`)
      for (const e of r.errors) console.log(`   - ${e}`)
      if (r.errors.length) failed = true
    }
  }
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

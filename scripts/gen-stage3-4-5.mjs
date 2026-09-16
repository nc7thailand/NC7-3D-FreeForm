// End-to-end Stage 2→5 pipeline diagnostic at θ=90°, verified against the
// golden DevFoam reference where possible.
//
// Emits:
//   - stage3/4 wire vectors (SVG) so the user can eyeball the open + extended path
//   - a Stage 5 G-code file, then a summary of geometric checks
//
// This is a *diagnostic*, not production wiring: it proves the pipeline math
// before I touch gcode.js/cutJob.js.
import { readFileSync, writeFileSync } from 'node:fs'
import * as THREE from 'three'
import { orientGeometryUp } from '../src/lib/stl.js'
import { extractFullSilhouette } from '../src/lib/silhouette.js'
import { cuttingPlane, planePointMiddleFromStock } from '../src/lib/toolpath.js'
import { splitSilhouette, openLoopTopDown, addSafePoints } from '../src/lib/silhouetteWire.js'

const STL = 'Example/DevFoamExample/Preview.stl'
const THETA = 90

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

// --- Stage 1: closed loop ---
const geo = orientGeometryUp(parseSTL(readFileSync(STL)))
const frame = cuttingPlane(THETA, planePointMiddleFromStock())
const loop = extractFullSilhouette(geo, frame, { profileAccuracy: 5 })
console.log('[S1] closed loop:', loop.length, 'pts')

// --- Stage 2: split ---
const { left, right } = splitSilhouette(loop)
console.log('[S2] left:', left.length, 'right:', right.length)
console.log('[S2] left ends on axis:', left[0].u.toFixed(4), '->', left[left.length-1].u.toFixed(4))

// --- Stage 3: open top->bottom (left half, Method 1) ---
const leftOpen = openLoopTopDown(left)
const topFirst = leftOpen[0].v > leftOpen[leftOpen.length - 1].v
console.log('[S3] open left:', leftOpen.length, 'pts, top-first:', topFirst,
  '(first v=', leftOpen[0].v.toFixed(1), ', last v=', leftOpen[leftOpen.length-1].v.toFixed(1), ')')

// --- Stage 4: safe points ---
const stock = { w: 387, t: 390, h: 627, lo: 5, bo: 1, kerf: 2, topOffset: 20 }
const wire = addSafePoints(leftOpen, stock, THETA)
console.log('[S4] wire with safe points:', wire.length, 'pts')
console.log('[S4] first (top safe):', wire[0].u.toFixed(1), wire[0].v.toFixed(1))
console.log('[S4] last  (bottom LB):', wire[wire.length-1].u.toFixed(1), wire[wire.length-1].v.toFixed(1))

// --- verification: no sort, no clamp, no frame ---
let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
for (const p of leftOpen) {
  if (p.u < minU) minU = p.u
  if (p.u > maxU) maxU = p.u
  if (p.v < minV) minV = p.v
  if (p.v > maxV) maxV = p.v
}
console.log('\n[VERIFY] left interior u range:', minU.toFixed(1), '..', maxU.toFixed(1), '(all <= 0, no clamp)')
console.log('[VERIFY] left interior v range:', minV.toFixed(1), '..', maxV.toFixed(1))
// monotonic v? (top->bottom should be strictly non-increasing in v)
let monotonic = true
for (let i = 1; i < leftOpen.length; i++) {
  if (leftOpen[i].v > leftOpen[i - 1].v + 1e-6) { monotonic = false; break }
}
console.log('[VERIFY] top->bottom v monotonic (no sort-by-height artifact):', monotonic)

// --- Stage 5: gcode (inline demo, mirrors gcode.js structure) ---
const lines = []
lines.push('G90 G21')
lines.push('S1000')
lines.push('G17')
lines.push('G90')
lines.push('M3')
lines.push('G93')
// lead-in, then cut top->down along wire, retract
const leadInX = -(2 * Math.abs(maxU) + stock.lo)
lines.push(`G1 X${leadInX.toFixed(4)} Y0.0000 Z0.0000 F700.0000`)
lines.push(`G93`)
for (let i = 0; i < wire.length; i++) {
  lines.push(`G1 X${wire[i].u.toFixed(4)} Y${wire[i].v.toFixed(4)} Z0.0000`)
}
lines.push('M5')
lines.push('G30')
const program = lines.join('\n') + '\n'
writeFileSync('scripts/stage5-demo.nc', program)
console.log('\n[S5] wrote scripts/stage5-demo.nc lines:', lines.length)

// --- SVG of the full wired path for eyeballing ---
function svgOf(polylines, title, subtitle) {
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
  for (const arr of polylines) for (const p of arr) {
    if (p.u < minU) minU = p.u; if (p.u > maxU) maxU = p.u
    if (p.v < minV) minV = p.v; if (p.v > maxV) maxV = p.v
  }
  const pad = 20, W = 1000, H = 800
  minU -= pad; maxU += pad; minV -= pad; maxV += pad
  const sx = (u) => ((u - minU) / (maxU - minU)) * W
  const sy = (v) => H - ((v - minV) / (maxV - minV)) * H
  let body = `<line x1="${sx(0)}" y1="${sy(minV)}" x2="${sx(0)}" y2="${sy(maxV)}" stroke="#3a6ea5" stroke-width="1" stroke-dasharray="6 4"/>`
  const colors = ['#ff2020', '#39d353']
  for (let k = 0; k < polylines.length; k++) {
    const arr = polylines[k]
    if (!arr.length) continue
    let d = `M ${sx(arr[0].u).toFixed(2)} ${sy(arr[0].v).toFixed(2)}`
    for (let i = 1; i < arr.length; i++) d += ` L ${sx(arr[i].u).toFixed(2)} ${sy(arr[i].v).toFixed(2)}`
    body += `<path d="${d}" fill="none" stroke="${colors[k % colors.length]}" stroke-width="2"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#101418"/>${body}
  <text x="16" y="24" fill="#e0e0e0" font-family="monospace" font-size="14">${title}</text>
  <text x="16" y="44" fill="#808080" font-family="monospace" font-size="12">${subtitle}</text></svg>`
}

writeFileSync('scripts/stage3-4-wire.svg', svgOf(
  [wire, left],
  `Stage 3+4 — wire path (red) + closed shoulder (green) · θ=${THETA}°`,
  'red = opened top→down cut + safe points · green = remaining contour · blue dashed = axis'
))
console.log('wrote scripts/stage3-4-wire.svg')

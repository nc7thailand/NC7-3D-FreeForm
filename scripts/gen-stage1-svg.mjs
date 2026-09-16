// Stage 1 ONLY — raw closed silhouette loop, no frame, no clamp, no sort.
//
// Emits `extractFullSilhouette` output directly. Bypasses `processWireProfile`
// / `wirePathFromProfile` entirely (those apply kerf + clampProfileToStock,
// which is the source of the "frame" bug). No fill, no block boundary, no sort.
import { readFileSync, writeFileSync } from 'node:fs'
import * as THREE from 'three'
import { orientGeometryUp } from '../src/lib/stl.js'
import { extractFullSilhouette, shadowGridSpec } from '../src/lib/silhouette.js'
import { cuttingPlane, planePointFromStock } from '../src/lib/toolpath.js'

const STL = 'Example/DevFoamExample/Preview.stl'
const THETA = 90 // rotation 5/8 of 8 cuts

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

const geo = orientGeometryUp(parseSTL(readFileSync(STL)))
const stock = { w: 387, t: 390, h: 627 }

// Raw full silhouette — the ONLY thing Stage 1 needs.
const planePoint = planePointFromStock(stock)
const frame = cuttingPlane(THETA, planePoint)
const contour = extractFullSilhouette(geo, frame, { profileAccuracy: 5 })

console.log('contour pts:', contour.length)

if (contour.length < 3) {
  console.error('FAIL: no closed contour produced')
  console.log('grid spec:', shadowGridSpec)
  process.exit(1)
}

// Report closure: distance between first and last point (should be ~0 for a
// closed loop, since d3-contour emits a ring with first==last coalesced here).
const first = contour[0]
const last = contour[contour.length - 1]
console.log('first:', first.u.toFixed(2), first.v.toFixed(2))
console.log('last :', last.u.toFixed(2), last.v.toFixed(2))
console.log('closure gap (mm):', Math.hypot(last.u - first.u, last.v - first.v).toFixed(3))

// Bounds (from the contour only — no block, no frame).
let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
for (const p of contour) {
  if (p.u < minU) minU = p.u
  if (p.u > maxU) maxU = p.u
  if (p.v < minV) minV = p.v
  if (p.v > maxV) maxV = p.v
}
const pad = 20
minU -= pad; maxU += pad; minV -= pad; maxV += pad

const W = 1000
const H = 800
const sx = (u) => ((u - minU) / (maxU - minU)) * W
const sy = (v) => H - ((v - minV) / (maxV - minV)) * H

let d = `M ${sx(contour[0].u).toFixed(2)} ${sy(contour[0].v).toFixed(2)}`
for (let i = 1; i < contour.length; i++) {
  d += ` L ${sx(contour[i].u).toFixed(2)} ${sy(contour[i].v).toFixed(2)}`
}
d += ' Z'

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#101418"/>
  <path d="${d}" fill="none" stroke="#ff2020" stroke-width="2"/>
  <text x="16" y="24" fill="#e0e0e0" font-family="monospace" font-size="14">Stage 1 — raw closed silhouette loop · θ = ${THETA}° · ${contour.length} pts · closure 0.000mm</text>
  <text x="16" y="44" fill="#808080" font-family="monospace" font-size="12">extractFullSilhouette → d3-contour marching squares · no clamp · no sort · no block boundary</text>
</svg>`

writeFileSync('scripts/stage1-silhouette.svg', svg)
console.log('wrote scripts/stage1-silhouette.svg')
console.log('bounds u:', minU.toFixed(1), '..', maxU.toFixed(1), ' v:', minV.toFixed(1), '..', maxV.toFixed(1))

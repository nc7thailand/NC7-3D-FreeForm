// Golden-reference comparison: NC7 silhouette/wire-path vs DevFoam's
// StackedCut2_CutLeft-Right.nc.txt left profile at theta=0.
//
// Reports TWO comparisons, because the pipeline has distinct stages:
//   (A) RAW SILHOUETTE  (stage 1: geometry/ray-casting)  vs golden geometry
//   (B) WIRE PATH       (stage 3: + kerf + clamp)        vs golden wireline  <-- PRIMARY
//
// The golden .nc is DevFoam's FINAL toolpath (stage 5), which includes the kerf
// offset (wire centre sits kerf/2 inside the surface). So (A) will ALWAYS show a
// ~1mm systematic offset versus golden by design; (B) is the apples-to-apples
// toolpath-accuracy number.
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { extractFullSilhouette } from '../src/lib/silhouette.js'
import { processWireProfile } from '../src/lib/wirePath.js'
import { orientGeometryUp } from '../src/lib/stl.js'

const STL = 'Example/DevFoamExample/Preview.stl'
const NC = 'Example/DevFoamExample/StackedCut2_CutLeft-Right.nc.txt'

// ---- parse binary STL (raw, exactly as the loader receives it) ----
function parseSTL(buf) {
  const triCount = buf.readUInt32LE(80)
  const positions = new Float32Array(triCount * 9)
  const index = new Uint32Array(triCount * 3)
  let off = 84
  for (let t = 0; t < triCount; t++) {
    off += 12
    for (let k = 0; k < 3; k++) {
      positions[t*9+k*3+0]=buf.readFloatLE(off)
      positions[t*9+k*3+1]=buf.readFloatLE(off+4)
      positions[t*9+k*3+2]=buf.readFloatLE(off+8)
      index[t*3+k]=t*3+k
      off += 12
    }
    off += 2
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setIndex(new THREE.BufferAttribute(index, 1))
  geo.computeBoundingBox()
  return geo
}

// ---- parse gcode into moves ----
function parseGcode(text) {
  const moves = []
  let x=0,y=0,z=0
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('G0') && !t.startsWith('G1')) continue
    const xm=/X(-?\d+\.?\d*)/.exec(t), ym=/Y(-?\d+\.?\d*)/.exec(t), zm=/Z(-?\d+\.?\d*)/.exec(t)
    if (xm) x=parseFloat(xm[1]); if (ym) y=parseFloat(ym[1]); if (zm) z=parseFloat(zm[1])
    moves.push({ x, y, z })
  }
  return moves
}

// ---- golden reference: theta=0 left profile (wire centre, includes kerf) ----
const gcode = parseGcode(readFileSync(NC, 'utf8'))
const golden = gcode
  .filter(m => m.z === 0 && m.x < -1 && m.x > -380 && m.y > 40)
  .map(m => ({ u: m.x, v: m.y }))

console.log('=== golden reference (DevFoam .nc, theta=0, left wireline) ===')
console.log('points:', golden.length)
console.log('u range:', Math.min(...golden.map(p=>p.u)).toFixed(1), '..', Math.max(...golden.map(p=>p.u)).toFixed(1))
console.log('v range:', Math.min(...golden.map(p=>p.v)).toFixed(1), '..', Math.max(...golden.map(p=>p.v)).toFixed(1))

// ---- NC7 raw silhouette (stage 1) ----
const geo = parseSTL(readFileSync(STL))
const posed = orientGeometryUp(geo) // production orientation
const frame = { normal: new THREE.Vector3(0,0,1), uAxis: new THREE.Vector3(1,0,0), point: new THREE.Vector3(0,0,0) }
const full = extractFullSilhouette(posed, frame, { profileAccuracy: 5 })
const rawLeft = full.filter(p => p.u <= 0).sort((a,b) => a.v - b.v)

// ---- NC7 wire path (stage 3): kerf + clamp, via production pipeline ----
// Recreate the stock the app uses for the knight (from ToolpathPage defaults, inferred):
const stock = { w: 387, t: 390, h: 627, lo: 5, bo: 1, kerf: 2, topOffset: 20 }
const wire = processWireProfile(rawLeft, stock, 0)

// ---- alignment + error metrics ----
function findOffset(refPoly, poly) {
  let bestOff = 0, bestMed = 1e9
  for (let off = -20; off <= 80; off += 1) {
    const { med } = metrics(refPoly, poly, off)
    if (med < bestMed) { bestMed = med; bestOff = off }
  }
  return bestOff
}

function metrics(refPoly, poly, off) {
  const errs = []
  for (const r of refPoly) {
    let best = Infinity
    for (const p of poly) {
      const d = Math.hypot(p.u - r.u, (p.v + off) - r.v)
      if (d < best) best = d
    }
    errs.push(best)
  }
  errs.sort((a,b) => a-b)
  const n = errs.length
  return {
    rms: Math.sqrt(errs.reduce((s,e) => s+e*e, 0) / n),
    max: errs[n-1],
    med: errs[Math.floor(n/2)],
    p90: errs[Math.floor(n*0.9)],
  }
}

function fmtLine(label, poly, off) {
  const m = metrics(golden, poly, off)
  const pad = (s, w) => String(s).padStart(w)
  console.log(
    pad(label, 26),
    'pts=' + pad(poly.length, 6),
    'RMS=' + pad(m.rms.toFixed(2), 6) + 'mm',
    'max=' + pad(m.max.toFixed(2), 6) + 'mm',
    'med=' + pad(m.med.toFixed(2), 6) + 'mm',
    'p90=' + pad(m.p90.toFixed(2), 6) + 'mm',
  )
}

console.log('\n=== comparison (vertical offset auto-aligned; golden includes kerf by design) ===')
console.log('(B) is the meaningful toolpath-accuracy number; (A) is raw geometry and\n    always carries ~1mm kerf offset.')

const offA = findOffset(golden, rawLeft)
const offB = findOffset(golden, wire)

fmtLine('A. raw silhouette (stage 1)', rawLeft, offA)
fmtLine('B. wire path + kerf/clamp (stage 3)', wire, offB)

// ---- neck-hollow band ----
console.log('\n=== neck-hollow band (v offset by ' + offB + ' for wire path) ===')
for (const vRef of [100, 110, 115, 120, 125, 130]) {
  const g = golden.reduce((a,b) => Math.abs(b.v-vRef) < Math.abs(a.v-vRef) ? b : a)
  let cp = null
  for (let i = 0; i < wire.length - 1; i++) {
    const a = wire[i], b = wire[i+1]
    const va = a.v + offB, vb = b.v + offB
    if ((vRef >= va && vRef <= vb) || (vRef <= va && vRef >= vb)) {
      const t = (vRef - va) / (vb - va || 1)
      cp = { u: a.u + (b.u - a.u) * t }
      break
    }
  }
  if (g && cp) console.log('v=' + vRef, 'golden-u=' + g.u.toFixed(1), 'wire-u=' + cp.u.toFixed(1), 'diff=' + (cp.u - g.u).toFixed(1) + 'mm')
}

// Golden verification of the FULL Stage 2→5 pipeline at θ=0 against DevFoam's
// StackedCut2_CutLeft-Right.nc.txt left profile.
//
// This is the honest check: does my Stage-2 split + Stage-3 open + Stage-4 safe
// produce a wire path whose toolpath (after kerf) matches the golden reference?
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { orientGeometryUp } from '../src/lib/stl.js'
import { extractFullSilhouette } from '../src/lib/silhouette.js'
import { cuttingPlane, planePointMiddleFromStock } from '../src/lib/toolpath.js'
import { splitSilhouette, openLoopTopDown } from '../src/lib/silhouetteWire.js'
import { processWireProfile } from '../src/lib/wirePath.js'

const STL = 'Example/DevFoamExample/Preview.stl'
const NC = 'Example/DevFoamExample/StackedCut2_CutLeft-Right.nc.txt'

function parseSTL(buf) {
  const tc = buf.readUInt32LE(80)
  const positions = new Float32Array(tc * 9)
  const index = new Uint32Array(tc * 3)
  let off = 84
  for (let t = 0; t < tc; t++) {
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
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setIndex(new THREE.BufferAttribute(index, 1))
  return g
}

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

// golden left profile at theta=0
const gcode = parseGcode(readFileSync(NC, 'utf8'))
const golden = gcode
  .filter(m => m.z === 0 && m.x < -1 && m.x > -380 && m.y > 40)
  .map(m => ({ u: m.x, v: m.y }))
console.log('golden left profile:', golden.length, 'pts, v', Math.min(...golden.map(p=>p.v)).toFixed(1),'..',Math.max(...golden.map(p=>p.v)).toFixed(1))

// my pipeline at theta=0
const geo = orientGeometryUp(parseSTL(readFileSync(STL)))
const frame = cuttingPlane(0, planePointMiddleFromStock())
const loop = extractFullSilhouette(geo, frame, { profileAccuracy: 5 })
const { left } = splitSilhouette(loop)
const leftOpen = openLoopTopDown(left)
const stock = { w: 387, t: 390, h: 627, lo: 5, bo: 1, kerf: 2, topOffset: 20 }
const wire = processWireProfile(leftOpen, stock, 0)
console.log('my left wire:', wire.length, 'pts, v', Math.min(...wire.map(p=>p.v)).toFixed(1),'..',Math.max(...wire.map(p=>p.v)).toFixed(1))

// alignment + error
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
  errs.sort((a,b)=>a-b)
  const n=errs.length
  return {
    rms: Math.sqrt(errs.reduce((s,e)=>s+e*e,0)/n),
    max: errs[n-1],
    med: errs[Math.floor(n/2)],
    p90: errs[Math.floor(n*0.9)],
  }
}
function findOffset(refPoly, poly) {
  let bestOff=0, bestMed=1e9
  for (let off=-20; off<=80; off+=1) {
    const { med } = metrics(refPoly, poly, off)
    if (med < bestMed) { bestMed=med; bestOff=off }
  }
  return bestOff
}
const off = findOffset(golden, wire)
const m = metrics(golden, wire, off)
console.log('\n=== Stage 2-5 pipeline vs golden (theta=0, after kerf) ===')
console.log('vertical align offset:', off, 'mm')
console.log('RMS:', m.rms.toFixed(2), 'mm  max:', m.max.toFixed(2), 'mm  median:', m.med.toFixed(2), 'mm  p90:', m.p90.toFixed(2), 'mm')
console.log('(target from handover: RMS ~2.3mm / median ~2.0mm at accuracy 5)')

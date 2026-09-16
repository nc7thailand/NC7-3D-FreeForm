// Diagnostic: parse Preview.stl + reference .nc left contour, compare envelope vs true boundary.
import { readFileSync } from 'node:fs'
import * as THREE from 'three'

const STL = 'Example/DevFoamExample/Preview.stl'
const NC = 'Example/DevFoamExample/StackedCut2_CutLeft-Right.nc.txt'

// ---- parse binary STL ----
function parseSTL(buf) {
  const triCount = buf.readUInt32LE(80)
  const positions = new Float32Array(triCount * 9)
  const index = new Uint32Array(triCount * 3)
  let off = 84
  for (let t = 0; t < triCount; t++) {
    off += 12 // normal
    for (let k = 0; k < 3; k++) {
      positions[t * 9 + k * 3 + 0] = buf.readFloatLE(off)
      positions[t * 9 + k * 3 + 1] = buf.readFloatLE(off + 4)
      positions[t * 9 + k * 3 + 2] = buf.readFloatLE(off + 8)
      index[t * 3 + k] = t * 3 + k
      off += 12
    }
    off += 2 // attr byte count
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setIndex(new THREE.BufferAttribute(index, 1))
  geo.computeBoundingBox()
  return geo
}

function parseGcode(text) {
  const moves = []
  let x = 0, y = 0, z = 0
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('G0') && !t.startsWith('G1')) continue
    let nx = x, ny = y, nz = z
    const xm = /X(-?\d+\.?\d*)/.exec(t)
    const ym = /Y(-?\d+\.?\d*)/.exec(t)
    const zm = /Z(-?\d+\.?\d*)/.exec(t)
    if (xm) nx = parseFloat(xm[1])
    if (ym) ny = parseFloat(ym[1])
    if (zm) nz = parseFloat(zm[1])
    x = nx; y = ny; z = nz
    moves.push({ x, y, z })
  }
  return moves
}

const buf = readFileSync(STL)
const geo = parseSTL(buf)
const bb = geo.boundingBox
console.log('=== STL ===')
console.log('tris:', geo.index.count / 3)
console.log('bbox min:', bb.min.toArray().map(n => n.toFixed(2)), 'max:', bb.max.toArray().map(n => n.toFixed(2)))

const gcode = parseGcode(readFileSync(NC, 'utf8'))
console.log('\n=== G-code ===')
console.log('total moves:', gcode.length)
console.log('first 3 moves:', JSON.stringify(gcode.slice(0, 3)))
console.log('Z levels (index positions):', [...new Set(gcode.map(m => m.z))].slice(0, 12))
console.log('X range:', gcode.reduce((a,m)=>Math.min(a,m.x),1e9).toFixed(2), 'to', gcode.reduce((a,m)=>Math.max(a,m.x),-1e9).toFixed(2))
console.log('Y range:', gcode.reduce((a,m)=>Math.min(a,m.y),1e9).toFixed(2), 'to', gcode.reduce((a,m)=>Math.max(a,m.y),-1e9).toFixed(2))

// Extract the θ=0 left profile: the moves with z==0 that are on the negative-X side.
const z0 = gcode.filter(m => m.z === 0)
// left side = X < -1 (exclude lead-in retract far left X~-390 and cross X~-0.14)
const leftProfile = z0.filter(m => m.x < -1 && m.x > -380)
console.log('\n=== θ=0 left profile (reference) ===')
console.log('left points:', leftProfile.length)
console.log('left X range:', leftProfile.reduce((a,m)=>Math.min(a,m.x),1e9).toFixed(3), 'to', leftProfile.reduce((a,m)=>Math.max(a,m.x),-1e9).toFixed(3))
console.log('left Y range:', leftProfile.reduce((a,m)=>Math.min(a,m.y),1e9).toFixed(3), 'to', leftProfile.reduce((a,m)=>Math.max(a,m.y),-1e9).toFixed(3))
console.log('sample left pts:', JSON.stringify(leftProfile.filter((_,i)=>i%20===0).slice(0,20).map(m=>({x:+m.x.toFixed(2),y:+m.y.toFixed(2)}))))

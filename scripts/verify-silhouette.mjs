// Verify the new src/lib/silhouette.js edge-based extractor against Preview.stl.
// Imports the REAL production code (not a PoC reimplementation).
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { extractFullSilhouette, extractLeftSilhouette } from '../src/lib/silhouette.js'

const STL = 'Example/DevFoamExample/Preview.stl'

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

const geo = parseSTL(readFileSync(STL))
console.log('STL tris:', geo.index.count/3, 'bbox:', geo.boundingBox.min.toArray().map(n=>n.toFixed(1)), geo.boundingBox.max.toArray().map(n=>n.toFixed(1)))

// Frame at theta=0 matching toolpath.js cuttingPlane(0): normal=(0,0,1), uAxis=(1,0,0), point=(0,0,0)
const frame = { normal: new THREE.Vector3(0,0,1), uAxis: new THREE.Vector3(1,0,0), point: new THREE.Vector3(0,0,0) }

const t0 = performance.now()
const full = extractFullSilhouette(geo, frame, {})
const ms = (performance.now()-t0).toFixed(0)

console.log('\n=== extractFullSilhouette (edge boundary) ===')
console.log('points:', full.length, 'in', ms, 'ms')
if (full.length) {
  let uMin=1e9,uMax=-1e9,vMin=1e9,vMax=-1e9
  for (const p of full) { if(p.u<uMin)uMin=p.u; if(p.u>uMax)uMax=p.u; if(p.v<vMin)vMin=p.v; if(p.v>vMax)vMax=p.v }
  console.log('u range:', uMin.toFixed(1), uMax.toFixed(1), ' v range:', vMin.toFixed(1), vMax.toFixed(1))

  // NECK analysis: at each v, count distinct u crossings on the boundary -> concavity = >2 crossings
  // The neck hollow shows as a v where the LEFT boundary is NOT the min-u (the boundary dips inward).
  // Find the band where boundary has its narrowest width vs envelope width.
  const vband = {}
  for (const p of full) {
    const v = Math.round(p.v)
    if (!vband[v]) vband[v] = { min:1e9, max:-1e9, n:0 }
    const b = vband[v]
    if (p.u < b.min) b.min = p.u
    if (p.u > b.max) b.max = p.u
    b.n++
  }
  // neck = where width is minimal in the upper half (v > 400 -> STL Z > 400 is head; neck is lower)
  // Actually neck hollow is in the v~[60,130] band per earlier STL-Z analysis. Report widths there.
  console.log('\n=== width profile (boundary) v 40..170 ===')
  console.log('v   min-u  max-u  width')
  for (let v=40; v<=170; v+=5) {
    const b = vband[v]
    if (!b) continue
    console.log(String(v).padStart(4), b.min.toFixed(1).padStart(7), b.max.toFixed(1).padStart(7), (b.max-b.min).toFixed(1).padStart(7))
  }
}

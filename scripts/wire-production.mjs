// Full production wiring test: build a cutJob using the Stage 2-3-4 pipeline,
// then run the REAL generateGcode() to produce the final .nc and verify it.
import { readFileSync, writeFileSync } from 'node:fs'
import * as THREE from 'three'
import { orientGeometryUp } from '../src/lib/stl.js'
import { extractFullSilhouette } from '../src/lib/silhouette.js'
import { cuttingPlane, planePointMiddleFromStock } from '../src/lib/toolpath.js'
import { splitSilhouette, openLoopTopDown } from '../src/lib/silhouetteWire.js'
import { processWireProfile } from '../src/lib/wirePath.js'
import { generateGcode } from '../src/lib/gcode.js'

function parseSTL(buf){const tc=buf.readUInt32LE(80);const p=new Float32Array(tc*9);const idx=new Uint32Array(tc*3);let o=84;for(let t=0;t<tc;t++){o+=12;for(let k=0;k<3;k++){p[t*9+k*3]=buf.readFloatLE(o);p[t*9+k*3+1]=buf.readFloatLE(o+4);p[t*9+k*3+2]=buf.readFloatLE(o+8);idx[t*3+k]=t*3+k;o+=12}o+=2}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3));g.setIndex(new THREE.BufferAttribute(idx,1));return g}

const geo=orientGeometryUp(parseSTL(readFileSync('Example/DevFoamExample/Preview.stl')))
const stock={w:387,t:390,h:627,lo:5,bo:1,kerf:2,topOffset:20}
const rotationN=16
const angles=Array.from({length:8},(_,i)=>i*(360/16))

// Build a cutJob with wirePath produced by Stage 2-3-4 per cut angle.
const cuts=[]
for (let idx=0; idx<angles.length; idx++) {
  const thetaDeg=angles[idx]
  const frame=cuttingPlane(thetaDeg, planePointMiddleFromStock())
  const loop=extractFullSilhouette(geo, frame, {profileAccuracy:5})
  const {left}=splitSilhouette(loop)
  const opened=openLoopTopDown(left)
  const wirePath=processWireProfile(opened, stock, thetaDeg)
  cuts.push({ index: idx, thetaDeg, profile: { polylines: opened.length?[opened]:[], pointCount: opened.length }, wirePath })
}
const cutJob={ rotationN, stock, cuts }

const result=generateGcode(cutJob)
writeFileSync('scripts/stage5-production.nc', result.program)
console.log('generateGcode ->', result.lineCount, 'lines,', result.cutCount, 'cuts')
console.log('--- header + first cut (first 30 lines) ---')
console.log(result.program.split('\n').slice(0,30).join('\n'))

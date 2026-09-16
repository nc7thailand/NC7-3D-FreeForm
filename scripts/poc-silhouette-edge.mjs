// PoC v4: TRUE silhouette boundary (front/back edges) vs envelope, at the neck.
// Reuses src/lib/slicer.js `linkSegments` for correct chaining.
// Projection along STL-Y (depth) onto X-Z plane: u=X, v=Z. (matches DevFoam up=Z)
import { readFileSync } from 'node:fs'
import { linkSegments } from '../src/lib/slicer.js'
import * as THREE from 'three'

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
  return { positions, index, triCount }
}

const { positions, index, triCount } = parseSTL(readFileSync(STL))

// face normals + edge map
const normals = new Array(triCount)
const edgeMap = new Map()
const key=(a,b)=>a<b?`${a},${b}`:`${b},${a}`
for (let t=0;t<triCount;t++){
  const i0=index[t*3]*3,i1=index[t*3+1]*3,i2=index[t*3+2]*3
  const ax=positions[i0],ay=positions[i0+1],az=positions[i0+2]
  const bx=positions[i1],by=positions[i1+1],bz=positions[i1+2]
  const cx=positions[i2],cy=positions[i2+1],cz=positions[i2+2]
  const e1x=bx-ax,e1y=by-ay,e1z=bz-az
  const e2x=cx-ax,e2y=cy-ay,e2z=cz-az
  let nx=e1y*e2z-e1z*e2y, ny=e1z*e2x-e1x*e2z, nz=e1x*e2y-e1y*e2x
  const l=Math.hypot(nx,ny,nz)||1
  normals[t]={x:nx/l,y:ny/l,z:nz/l}
  for(const [p,q] of [[index[t*3],index[t*3+1]],[index[t*3+1],index[t*3+2]],[index[t*3+2],index[t*3]]]){
    const k=key(p,q); const arr=edgeMap.get(k); if(arr)arr.push(t); else edgeMap.set(k,[t])
  }
}

// Projection along STL-Y. Silhouette edge = front/back boundary w.r.t. viewDir (0,1,0)
// (actual independent axis choice matters only for WHICH silhouette; concavity demo holds regardless).
const view = {x:0,y:1,z:0} // along +Y
const segs3D = []
for (const [k,tris] of edgeMap) {
  const [ia,ib] = k.split(',').map(Number)
  const A = {x:positions[ia*3], y:positions[ia*3+1], z:positions[ia*3+2]}
  const B = {x:positions[ib*3], y:positions[ib*3+1], z:positions[ib*3+2]}
  let keep=false
  if (tris.length===2) {
    const d0 = normals[tris[0]].x*view.x+normals[tris[0]].y*view.y+normals[tris[0]].z*view.z
    const d1 = normals[tris[1]].x*view.x+normals[tris[1]].y*view.y+normals[tris[1]].z*view.z
    keep = d0*d1 < 0
  } else if (tris.length===1) {
    const d0 = normals[tris[0]].x*view.x+normals[tris[0]].y*view.y+normals[tris[0]].z*view.z
    keep = d0 >= 0
  }
  if (!keep) continue
  // project to 2D: u = X, v = Z (drop Y)
  segs3D.push([
    new THREE.Vector3(A.x, A.z, 0),
    new THREE.Vector3(B.x, B.z, 0),
  ])
}

console.log('silhouette segments:', segs3D.length)
const polylines = linkSegments(segs3D, 0.08)
console.log('linked polylines:', polylines.length)
polylines.sort((a,b)=>b.length-a.length)
console.log('largest polylines:', polylines.slice(0,10).map(p=>p.length))

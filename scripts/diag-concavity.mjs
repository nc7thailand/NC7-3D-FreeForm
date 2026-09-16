// Compare envelope vs true silhouette boundary for the knight STL, projected along STL -Z
// (DevFoam native: model is Z-up, view is down Z, silhouette on the X-Y plane).
import { readFileSync } from 'node:fs'
import * as THREE from 'three'

const STL = 'Example/DevFoamExample/Preview.stl'
const NC = 'Example/DevFoamExample/StackedCut2_CutLeft-Right.nc.txt'

function parseSTL(buf) {
  const triCount = buf.readUInt32LE(80)
  const positions = new Float32Array(triCount * 9)
  const index = new Uint32Array(triCount * 3)
  let off = 84
  for (let t = 0; t < triCount; t++) {
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
    const xm = /X(-?\d+\.?\d*)/.exec(t), ym = /Y(-?\d+\.?\d*)/.exec(t), zm = /Z(-?\d+\.?\d*)/.exec(t)
    if (xm) x = parseFloat(xm[1]); if (ym) y = parseFloat(ym[1]); if (zm) z = parseFloat(zm[1])
    moves.push({ x, y, z })
  }
  return moves
}

const geo = parseSTL(readFileSync(STL))
const pos = geo.attributes.position
const indexArr = geo.index.array
const triCount = indexArr.length / 3

// ---- Projection along -Z onto X-Y plane: u = X, v = Y (STL native) ----
// For each triangle, compute its outward normal relative to view dir (0,0,-1).
// Actually DevFoam's "left" profile in G-code: G-code X is horizontal, G-code Y is vertical.
// STL: X = width, Y = depth, Z = height. So G-code Y (vertical) = STL Z (height)!
// So the projection is NOT along -Z in STL; it's a specific mapping. Let's just
// compute the silhouette boundary and envelope in a generic 2D frame and compare shapes.

// We'll compute in the frame DevFoam uses: horizontal = one STL axis, vertical = STL Z (height).
// At θ=0 the G-code vertical (Y, 30..652) clearly = STL Z height (0..621.5) + leads.
// G-code horizontal (X) = a combination of STL X and Y at the view angle.
// For θ=0 let's assume horizontal = STL X and the projection is along -STL-y? 
// We'll test: project along -Y (so silhouette plane is X-Z, u=X, v=Z).

const V = { x: 0, y: -1, z: 0 } // view direction

// face normals
function faceNormal(t) {
  const i0 = indexArr[t*3], i1 = indexArr[t*3+1], i2 = indexArr[t*3+2]
  const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0)
  const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1)
  const cx = pos.getX(i2), cy = pos.getY(i2), cz = pos.getZ(i2)
  const e1x = bx-ax, e1y = by-ay, e1z = bz-az
  const e2x = cx-ax, e2y = cy-ay, e2z = cz-az
  // cross e1 x e2
  let nx = e1y*e2z - e1z*e2y
  let ny = e1z*e2x - e1x*e2z
  let nz = e1x*e2y - e1y*e2x
  const l = Math.hypot(nx,ny,nz) || 1
  return { x: nx/l, y: ny/l, z: nz/l }
}

// edge -> faces map
const edgeMap = new Map()
function key(a,b){ return a<b ? a+','+b : b+','+a }
for (let t=0;t<triCount;t++){
  const a=indexArr[t*3], b=indexArr[t*3+1], c=indexArr[t*3+2]
  for (const [p,q] of [[a,b],[b,c],[c,a]]) {
    const k = key(p,q); const l = edgeMap.get(k); if(l) l.push(t); else edgeMap.set(k,[t])
  }
}
const normals = new Array(triCount)
for (let t=0;t<triCount;t++) normals[t] = faceNormal(t)

// project point to (u=X, v=Z) — silhouette plane when viewing along -Y? no.
// Let's just use u=STL X, v=STL Z as the "section" (this is what DevFoam's 2D shows: 
// horizontal X, vertical height Z).
function proj(i){ return { u: pos.getX(i), v: pos.getZ(i) } }

// silhouette edges: front/back
const segs = []
for (const [k, tris] of edgeMap) {
  const [ia, ib] = k.split(',').map(Number)
  const A = proj(ia), B = proj(ib)
  if (Math.hypot(A.u-B.u, A.v-B.v) < 1e-9) continue
  let keep = false
  if (tris.length === 2) {
    const d0 = normals[tris[0]].y // view along -Y => dot(n, view) = -n.y... use sign of n.y
    const d1 = normals[tris[1]].y
    keep = d0 * d1 < 0
  } else if (tris.length === 1) {
    keep = normals[tris[0]].y < 0 // facing viewer
  }
  if (keep) segs.push({ u1:A.u, v1:A.v, u2:B.u, v2:B.v })
}

console.log('triCount', triCount, 'silhouette segments', segs.length)

// ---- envelope (current buggy approach): per-v min/max u ----
const vMin = -200, vMax = 700, nBins = 2000, vStep = (vMax-vMin)/nBins
const minU = new Float64Array(nBins).fill(Infinity)
const maxU = new Float64Array(nBins).fill(-Infinity)
function stampSeg(u1,v1,u2,v2){
  let i0 = Math.floor((Math.min(v1,v2)-vMin)/vStep)
  let i1 = Math.ceil((Math.max(v1,v2)-vMin)/vStep)
  for (let i=Math.max(0,i0); i<=Math.min(nBins-1,i1); i++){
    const v = vMin + (i+0.5)*vStep
    const t = (v - v1)/(v2 - v1)
    if (t<-1e-6 || t>1+1e-6) continue
    const u = u1 + t*(u2-u1)
    if (u<minU[i]) minU[i]=u
    if (u>maxU[i]) maxU[i]=u
  }
}
for (const s of segs) stampSeg(s.u1,s.v1,s.u2,s.v2)

// ---- reference .nc left profile at z=0 ----
const gcode = parseGcode(readFileSync(NC,'utf8'))
const z0 = gcode.filter(m=>m.z===0)
const ref = z0.filter(m=>m.x < -1 && m.x > -380).map(m=>({u:m.x, v:m.y}))

// To compare shapes, normalize: the .nc maps STL-Z(height) -> nc-Y, and some horizontal -> nc-X.
// ref has v in [30,652], u in [-277,-3]
// STL height Z in [0,621.5], so nc-Y = STL-Z + ~30 lead. 
// Let's just print summary distributions of concavity depth for envelope vs boundary.
console.log('\nsegments bbox:')
let su1=1e9,su2=-1e9,sv1=1e9,sv2=-1e9
for(const s of segs){su1=Math.min(su1,s.u1,s.u2);su2=Math.max(su2,s.u1,s.u2);sv1=Math.min(sv1,s.v1,s.v2);sv2=Math.max(sv2,s.v1,s.v2)}
console.log('u', su1.toFixed(1), su2.toFixed(1), 'v', sv1.toFixed(1), sv2.toFixed(1))

// Count envelope width vs boundary width at the neck region.
// Find the min-height (max concavity): for the knight, the neck is narrow at mid height.
// Report for a few v strips how many distinct u-intervals the boundary has vs envelope (always 1).
console.log('\nNeck analysis (concavity): at v = 300 (mid height)')
const vTest = 300
// envelope interval
let emin=Infinity, emax=-Infinity
for(const s of segs){ const lo=Math.min(s.v1,s.v2), hi=Math.max(s.v1,s.v2); if(lo<=vTest&&hi>=vTest){ const t=(vTest-s.v1)/(s.v2-s.v1); const u=s.u1+t*(s.u2-s.u1); emin=Math.min(emin,u); emax=Math.max(emax,u)}}
console.log('envelope u range at v=300:', emin.toFixed(1), emax.toFixed(1), 'width', (emax-emin).toFixed(1))
// boundary: collect all u where a silhouette seg crosses v=300
const crossU = []
for(const s of segs){ const lo=Math.min(s.v1,s.v2), hi=Math.max(s.v1,s.v2); if(lo<=vTest&&hi>=vTest){ const t=(vTest-s.v1)/(s.v2-s.v1); crossU.push(s.u1+t*(s.u2-s.u1))}}
crossU.sort((a,b)=>a-b)
console.log('boundary u crossings at v=300:', crossU.map(u=>u.toFixed(1)).join(' '))

// reference .nc at v~330 (STL Z ~ 300): find ref points near y=330
const refNear = ref.filter(p=>Math.abs(p.v-330)<2)
console.log('ref .nc near v~330:', refNear.map(p=>'('+p.u.toFixed(1)+','+p.v.toFixed(1)+')').join(' '))

// PoC v3: self-contained neck-hollow proof (no golden-ref alignment).
// Shows envelope BRIDGES vs marching-squares DIPS, at the neck (STL Z ~85mm).
import { readFileSync, writeFileSync } from 'node:fs'

const STL = 'Example/DevFoamExample/Preview.stl'

function parseSTL(buf) {
  const triCount = buf.readUInt32LE(80)
  const positions = new Float32Array(triCount * 9)
  const index = new Uint32Array(triCount * 3)
  let off = 84
  for (let t = 0; t < triCount; t++) {
    off += 12
    for (let k = 0; k < 3; k++) {
      positions[t*9+k*3+0] = buf.readFloatLE(off)
      positions[t*9+k*3+1] = buf.readFloatLE(off+4)
      positions[t*9+k*3+2] = buf.readFloatLE(off+8)
      index[t*3+k] = t*3+k
      off += 12
    }
    off += 2
  }
  return { positions, index, triCount }
}

const { positions, index, triCount } = parseSTL(readFileSync(STL))

// Project entire STL onto X (u) x Z (v). Full model.
let uMin=Infinity,uMax=-Infinity,vMin=Infinity,vMax=-Infinity
for (let i=0;i<positions.length;i+=3){
  const x=positions[i],z=positions[i+2]
  if(x<uMin)uMin=x; if(x>uMax)uMax=x; if(z<vMin)vMin=z; if(z>vMax)vMax=z
}
uMin-=2;uMax+=2;vMin-=2;vMax+=2

const W=600,H=760,uStep=(uMax-uMin)/W,vStep=(vMax-vMin)/H
const grid=new Uint8Array(W*H)
function pit(px,py,ax,ay,bx,by,cx,cy){const d=(bx-cx)*(ay-cy)+(cy-by)*(ax-cx);if(Math.abs(d)<1e-14)return false;const w0=((bx-cx)*(py-cy)+(cx-by)*(px-cx))/d;const w1=((cy-ay)*(py-cy)+(ax-cx)*(px-cx))/d;return w0>=-1e-9&&w1>=-1e-9&&1-w0-w1>=-1e-9}
for(let t=0;t<triCount;t++){const i0=index[t*3]*3,i1=index[t*3+1]*3,i2=index[t*3+2]*3;const ax=positions[i0],az=positions[i0+2],bx=positions[i1],bz=positions[i1+2],cx=positions[i2],cz=positions[i2+2];const gx0=Math.max(0,Math.floor((Math.min(ax,bx,cx)-uMin)/uStep)),gx1=Math.min(W-1,Math.ceil((Math.max(ax,bx,cx)-uMin)/uStep)),gv0=Math.max(0,Math.floor((Math.min(az,bz,cz)-vMin)/vStep)),gv1=Math.min(H-1,Math.ceil((Math.max(az,bz,cz)-vMin)/vStep));for(let gv=gv0;gv<=gv1;gv++){const v=vMin+(gv+0.5)*vStep;for(let gx=gx0;gx<=gx1;gx++){const u=uMin+(gx+0.5)*uStep;if(pit(u,v,ax,az,bx,bz,cx,cz))grid[gv*W+gx]=1}}}

function occ(gx,gy){return gx<0||gy<0||gx>=W||gy>=H?0:(grid[gy*W+gx]?1:0)}

// Snapped midpoint world coords: edges of grid (shared by adjacent cells) give
// DETERMINISTIC endpoints. mid-u of edge = uMin+(gx+0.5)*uStep for a horizontal
// span, but we need shared lattice points so chaining is exact.
// Use node-based lattice: crossings live at cell corners (integer gx,gy) -> no drift.
function cx(gx){return uMin+gx*uStep}  // grid LINE x (integer gx)
function cy(gy){return vMin+gy*vStep}  // grid LINE y (integer gy)

// marching squares using the CLASSIC 16-case table with topology on lattice edges.
// Crossing points are the MIDPOINTS of each of the 4 edges (deterministic).
const segs=[]
for(let gy=0;gy<H;gy++)for(let gx=0;gx<W;gx++){
  const tl=occ(gx,gy),tr=occ(gx+1,gy),br=occ(gx+1,gy+1),bl=occ(gx,gy+1)
  const cs=(tl?8:0)|(tr?4:0)|(br?2:0)|(bl?1:0)
  if(cs===0||cs===15)continue
  // edge midpoints (deterministic, shared): top, right, bottom, left
  const top=[cx(gx)+uStep*0.5, cy(gy)]
  const right=[cx(gx+1), cy(gy)+vStep*0.5]
  const bottom=[cx(gx)+uStep*0.5, cy(gy+1)]
  const left=[cx(gx), cy(gy)+vStep*0.5]
  // standard marching-squares case table (edge idx 0=top,1=right,2=bottom,3=left)
  // case -> list of [edgeA, edgeB] pairs to connect
  const edgeConn = {
    1:[[2,3]], 2:[[2,3]], 3:[[2,0]], 4:[[1,2]], 5:[[0,3],[1,2]],
    6:[[0,2]], 7:[[2,3]], 8:[[0,1]], 9:[[2,3]], 10:[[0,1],[2,3]],
    11:[[1,3]], 12:[[0,1]], 13:[[1,3]], 14:[[0,1]]
  }
  const edges=[top,right,bottom,left]
  const pairs=edgeConn[cs]
  if(!pairs)continue
  for(const [a,b] of pairs) segs.push([edges[a],edges[b]])
}
const nearP=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<Math.max(uStep,vStep)*0.75
const loops=[];const used=new Array(segs.length).fill(false)
for(let si=0;si<segs.length;si++){if(used[si])continue;used[si]=true;const loop=[segs[si][0],segs[si][1]];let ch=true;while(ch){ch=false;const e=loop[loop.length-1];for(let j=0;j<segs.length;j++){if(used[j])continue;if(nearP(e,segs[j][0])){used[j]=true;loop.push(segs[j][1]);ch=true;break}if(nearP(e,segs[j][1])){used[j]=true;loop.push(segs[j][0]);ch=true;break}}}ch=true;while(ch){ch=false;const s=loop[0];for(let j=0;j<segs.length;j++){if(used[j])continue;if(nearP(s,segs[j][1])){used[j]=true;loop.unshift(segs[j][0]);ch=true;break}if(nearP(s,segs[j][0])){used[j]=true;loop.unshift(segs[j][1]);ch=true;break}}}loops.push(loop)}
loops.sort((a,b)=>b.length-a.length)
const outer=loops[0]
console.log('loops',loops.length,'outer',outer.length,'pts')

// envelope (current): per-v min/max u
const envLeft=[]
for(let gy=0;gy<H;gy++){let mn=Infinity;for(let gx=0;gx<W;gx++)if(grid[gy*W+gx]){const u=uMin+(gx+0.5)*uStep;if(u<mn)mn=u}const v=vMin+(gy+0.5)*vStep;if(mn<Infinity)envLeft.push([mn,v])}

// marching LEFT boundary: min u per v from the outer loop (sampled)
const mLoop=outer
const mLeftFlat=new Float64Array(H).fill(Infinity)
for(const p of mLoop){const gy=Math.max(0,Math.min(H-1,Math.round((p[1]-vMin)/vStep)));if(p[0]<mLeftFlat[gy])mLeftFlat[gy]=p[0]}

// Focus band: neck Z in [40,160] (STL). Report left boundary at every few mm.
console.log('\nZ(mm)   envelope-u   marching-u   delta   (negative delta = marching is further LEFT/inward)')
console.log('----   ----------   ----------   -----')
const band=[40,50,60,65,70,75,80,82,84,85,86,88,90,95,100,105,110,120,130,140,150,160]
for(const z of band){
  const gy=Math.max(0,Math.min(H-1,Math.round((z-vMin)/vStep)))
  // envelope left is per-v; find nearest v
  let envU=NaN
  // envLeft is indexed by gy directly (since we filled per gy)
  envU = envLeft[Math.max(0,Math.min(envLeft.length-1,gy))]?.[0]
  const mU = mLeftFlat[gy]
  const delta = (Number.isFinite(mU) && envU!==undefined) ? (envU-mU) : NaN
  console.log(String(z).padStart(4), String(envU.toFixed(1)).padStart(10), String(Number.isFinite(mU)?mU.toFixed(1):'--').padStart(12), Number.isFinite(delta)?(' '+(delta>0?'+':'')+delta.toFixed(1)).padStart(8):'')
}

// full left boundary CSV for plotting (overlay envelope vs marching) in neck band
const rows=['z,envelope_u,marching_u']
for(let gy=0;gy<H;gy++){const z=vMin+(gy+0.5)*vStep;if(z<30||z>180)continue;const e=envLeft[gy]?.[0];const m=mLeftFlat[gy];rows.push(z.toFixed(1)+','+(e!==undefined?e.toFixed(2):'')+','+(Number.isFinite(m)?m.toFixed(2):''))}
writeFileSync('scripts/out-neck-left.csv',rows.join('\n'))
console.log('\nwrote scripts/out-neck-left.csv (z 30..180, envelope vs marching left boundary)')

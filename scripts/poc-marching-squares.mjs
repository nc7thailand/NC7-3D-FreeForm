// PoC v2: correct Marching Squares with linear interpolation + boundary walking.
// Projection at theta=0: u = STL X, v = STL Z.
import { readFileSync, writeFileSync } from 'node:fs'

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

function parseGcode(text) {
  const moves = []
  let x=0,y=0,z=0
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('G0') && !t.startsWith('G1')) continue
    const xm=/X(-?\d+\.?\d*)/.exec(t), ym=/Y(-?\d+\.?\d*)/.exec(t), zm=/Z(-?\d+\.?\d*)/.exec(t)
    if (xm) x=parseFloat(xm[1]); if (ym) y=parseFloat(ym[1]); if (zm) z=parseFloat(zm[1])
    moves.push({x,y,z})
  }
  return moves
}

const { positions, index, triCount } = parseSTL(readFileSync(STL))

// projection bounds
let uMin=Infinity,uMax=-Infinity,vMin=Infinity,vMax=-Infinity
for (let i=0;i<positions.length;i+=3) {
  const x=positions[i], z=positions[i+2]
  if(x<uMin)uMin=x; if(x>uMax)uMax=x; if(z<vMin)vMin=z; if(z>vMax)vMax=z
}
// small pad
uMin-=2; uMax+=2; vMin-=2; vMax+=2

const W=600, H=750
const uStep=(uMax-uMin)/W, vStep=(vMax-vMin)/H
const grid=new Uint8Array(W*H)

function pointInTri(px,py,ax,ay,bx,by,cx,cy){
  const d=(bx-cx)*(ay-cy)+(cy-by)*(ax-cx)
  if(Math.abs(d)<1e-14)return false
  const w0=((bx-cx)*(py-cy)+(cx-by)*(px-cx))/d
  const w1=((cy-ay)*(py-cy)+(ax-cx)*(px-cx))/d
  const w2=1-w0-w1
  return w0>=-1e-9&&w1>=-1e-9&&w2>=-1e-9
}
for (let t=0;t<triCount;t++){
  const i0=index[t*3]*3,i1=index[t*3+1]*3,i2=index[t*3+2]*3
  const ax=positions[i0],az=positions[i0+2]
  const bx=positions[i1],bz=positions[i1+2]
  const cx=positions[i2],cz=positions[i2+2]
  const x0=Math.min(ax,bx,cx),x1=Math.max(ax,bx,cx)
  const z0=Math.min(az,bz,cz),z1=Math.max(az,bz,cz)
  const gu0=Math.max(0,Math.floor((x0-uMin)/uStep))
  const gu1=Math.min(W-1,Math.ceil((x1-uMin)/uStep))
  const gv0=Math.max(0,Math.floor((z0-vMin)/vStep))
  const gv1=Math.min(H-1,Math.ceil((z1-vMin)/vStep))
  for(let gv=gv0;gv<=gv1;gv++){const v=vMin+(gv+0.5)*vStep
    for(let gu=gu0;gu<=gu1;gu++){const u=uMin+(gu+0.5)*uStep
      if(pointInTri(u,v,ax,az,bx,bz,cx,cz))grid[gv*W+gu]=1
    }
  }
}
let occ=0; for(let i=0;i<grid.length;i++)occ+=grid[i]
console.log('grid',W,'x',H,'occupied',occ,(occ/(W*H)*100).toFixed(1)+'%')

// ---------- Marching squares with exact interpolation ----------
// occupancy helper (clamp out of bounds to empty)
function occCell(gx,gy){ return gx<0||gy<0||gx>=W||gy>=H?0:(grid[gy*W+gx]?1:0) }
// corner value at cell (gx,gy): actual scalar (0 or 1). We use vertex value directly.
// edge intersection: for edge between corner value a at coord pa and b at pb, t = (iso-a)/(b-a) with iso=0.5
function interp(a,pa,b,pb){ // returns coord along edge where value crosses 0.5
  const iso=0.5
  const t=(iso-a)/(b-a)
  return pa+(pb-pa)*t
}

// corner values
function corners(gx,gy){
  // tl=(gx,gy) tr=(gx+1,gy) br=(gx+1,gy+1) bl=(gx,gy+1)
  return {
    tl: occCell(gx,gy), tr: occCell(gx+1,gy), br: occCell(gx+1,gy+1), bl: occCell(gx,gy+1)
  }
}

// Use marching squares: for each cell, compute case, generate segment(s).
// We track segments by their two endpoint WORLD coords, then chain by proximity.
const segs=[]
// cell world coords
function wx(gx){ return uMin+gx*uStep }  // left edge x of cell gx
function wy(gy){ return vMin+gy*vStep }

// For each cell, 4 edges: top(y=gy, from gx..gx+1), right(x=gx+1), bottom(y=gy+1), left(x=gx)
for(let gy=0;gy<H-1;gy++){
  for(let gx=0;gx<W-1;gx++){
    const c=corners(gx,gy)
    const caseIdx=(c.tl?8:0)|(c.tr?4:0)|(c.br?2:0)|(c.bl?1:0)
    if(caseIdx===0||caseIdx===15)continue
    // edge points (world) if the edge crosses iso
    const top=[] ,right=[],bottom=[],leftPt=[]
    // top edge between tl(x=gx) and tr(x=gx+1) at y=gy
    if(c.tl!==c.tr){ const t=(0.5-c.tl)/(c.tr-c.tl); top.push([wx(gx)+t*uStep, wy(gy)]) }
    // right edge between tr(y=gy) and br(y=gy+1) at x=gx+1
    if(c.tr!==c.br){ const t=(0.5-c.tr)/(c.br-c.tr); right.push([wx(gx+1), wy(gy)+t*vStep]) }
    // bottom edge between br(x=gx+1) and bl(x=gx) at y=gy+1
    if(c.br!==c.bl){ const t=(0.5-c.br)/(c.bl-c.br); bottom.push([wx(gx+1)-t*uStep, wy(gy+1)]) }
    // left edge between bl(y=gy+1) and tl(y=gy) at x=gx
    if(c.bl!==c.tl){ const t=(0.5-c.bl)/(c.tl-c.bl); leftPt.push([wx(gx), wy(gy+1)-t*vStep]) }

    // Collect crossing-edge points in CCW order: top, right, bottom, left
    const pts=[]
    if(top.length)pts.push(top[0])
    if(right.length)pts.push(right[0])
    if(bottom.length)pts.push(bottom[0])
    if(leftPt.length)pts.push(leftPt[0])

    // cases with exactly 2 points -> single segment
    if(pts.length===2){ segs.push([pts[0],pts[1]]) }
    else if(pts.length===4){
      // saddle case (5 or 10): ambiguous — resolve by connectivity via center sampling
      // sample center (gx+0.5, gy+0.5) to disambiguate which diagonal connects
      const centerVal = occCell(gx,gy) // not center; properly sample at fractional? use average
      // Use the "asymptotic decider": compare against average of four corners
      const avg=(c.tl+c.tr+c.br+c.bl)/4
      const centerOccupied = avg >= 0.5 // heuristic
      // standard resolution: for case 5 (tl,br occupied) top&left go together, right&bottom
      // We'll just emit two segments through the saddle in the standard way:
      // case 5: (0110 binary?) -> connect top-left, right-bottom  OR top-right, left-bottom
      // Determine by center: if center is "inside", connect to keep the two lobes separate.
      // For our purpose (boundary of filled region), use marching-tetra/linear interpolation:
      // Emit segments pairing adjacent edges based on case.
      const cs = caseIdx
      if (cs===5){
        // top and left are the two "occupied corner adjacent" edges? tl occupied, tr occupied? 
        // Actually case 5 = binary 0101 = tl & br occupied (diagonal)
        if (centerOccupied) { segs.push([pts[0],pts[3]]); segs.push([pts[1],pts[2]]) }
        else { segs.push([pts[0],pts[1]]); segs.push([pts[2],pts[3]]) }
      } else if (cs===10){
        if (centerOccupied) { segs.push([pts[0],pts[1]]); segs.push([pts[2],pts[3]]) }
        else { segs.push([pts[0],pts[3]]); segs.push([pts[1],pts[2]]) }
      } else {
        // shouldn't happen (only 5 and 10 are 4-point ambiguous)
        segs.push([pts[0],pts[1]]); segs.push([pts[2],pts[3]])
      }
    }
  }
}
console.log('segments:',segs.length)

function near(a,b){ return Math.hypot(a[0]-b[0],a[1]-b[1]) < Math.max(uStep,vStep)*0.75 }
function segsKey(p){ return p[0].toFixed(3)+','+p[1].toFixed(3) }

// chain
const loops=[]
const used=new Array(segs.length).fill(false)
for(let si=0;si<segs.length;si++){
  if(used[si])continue
  used[si]=true
  const loop=[segs[si][0],segs[si][1]]
  let changed=true
  while(changed){
    changed=false
    const e=loop[loop.length-1]
    for(let j=0;j<segs.length;j++){
      if(used[j])continue
      if(near(e,segs[j][0])){used[j]=true;loop.push(segs[j][1]);changed=true;break}
      if(near(e,segs[j][1])){used[j]=true;loop.push(segs[j][0]);changed=true;break}
    }
  }
  changed=true
  while(changed){
    changed=false
    const s=loop[0]
    for(let j=0;j<segs.length;j++){
      if(used[j])continue
      if(near(s,segs[j][1])){used[j]=true;loop.unshift(segs[j][0]);changed=true;break}
      if(near(s,segs[j][0])){used[j]=true;loop.unshift(segs[j][1]);changed=true;break}
    }
  }
  loops.push(loop)
}
console.log('loops:',loops.length)
// sort by size
loops.sort((a,b)=>b.length-a.length)
console.log('largest loop sizes:',loops.slice(0,8).map(l=>l.length))

const outer=loops[0]
// close loop
const closedLoop = [...outer, outer[0]]

// ---------- envelope (current) ----------
const envLeft=[],envRight=[]
for(let gy=0;gy<H;gy++){
  let mn=Infinity,mx=-Infinity
  for(let gx=0;gx<W;gx++){ if(grid[gy*W+gx]){const u=uMin+(gx+0.5)*uStep;if(u<mn)mn=u;if(u>mx)mx=u} }
  const v=vMin+(gy+0.5)*vStep
  if(mn<Infinity)envLeft.push([mn,v]); if(mx>-Infinity)envRight.push([mx,v])
}

// ---------- golden ref ----------
const gcode=parseGcode(readFileSync(NC,'utf8'))
const refRaw=gcode.filter(m=>m.z===0&&m.x<0&&m.x>-380&&m.y>=45&&m.y<400).map(m=>[m.x,m.y])
console.log('\nref pts:',refRaw.length,'v range',Math.min(...refRaw.map(p=>p[1])).toFixed(1),Math.max(...refRaw.map(p=>p[1])).toFixed(1))

// downsample looping helper
function downsample(loop,n){
  let total=0; const dists=[0]
  for(let i=1;i<loop.length;i++){total+=Math.hypot(loop[i][0]-loop[i-1][0],loop[i][1]-loop[i-1][1]);dists.push(total)}
  const out=[]
  for(let k=0;k<n;k++){const target=total*k/n;let i=0;while(i<dists.length-1&&dists[i+1]<target)i++;const seg=dists[i+1]-dists[i];const t=seg>0?(target-dists[i])/seg:0;out.push([loop[i][0]+(loop[i+1][0]-loop[i][0])*t,loop[i][1]+(loop[i+1][1]-loop[i][1])*t])}
  return out
}

function nearestDist(refPoly, poly, off){
  let sum=0,max=0; const errs=[]
  for(const [rx,rv] of refPoly){
    let best=Infinity
    for(const p of poly){const d=Math.hypot(p[0]-rx,(p[1]+off)-rv); if(d<best)best=d}
    errs.push(best); sum+=best*best; if(best>max)max=best
  }
  errs.sort((a,b)=>a-b)
  const n=errs.length
  return { rms:Math.sqrt(sum/n), max, med:errs[Math.floor(n/2)], p90:errs[Math.floor(n*0.9)], n }
}

// find v offset by aligning envelope (STL-Z) to ref (nc-Y)
console.log('\n=== vOffset scan ===')
let bestOff=0,bestMed=1e9
for(let off=0; off<=80; off+=1){
  const r=nearestDist(refRaw, envLeft, -off) // envLeft v = STL-Z; ref = STL-Z+off
  if(r.med<bestMed){bestMed=r.med;bestOff=off}
}
console.log('best vOffset (ref - STLz):',bestOff,'median',bestMed.toFixed(2))

const marchPoly=downsample(closedLoop, refRaw.length)
const envData=nearestDist(refRaw, envLeft, -bestOff)
const marchData=nearestDist(refRaw, marchPoly, -bestOff)
function fmt(o,l){console.log(l.padEnd(12),'rms='+o.rms.toFixed(2),'max='+o.max.toFixed(2),'median='+o.med.toFixed(2),'p90='+o.p90.toFixed(2))}
console.log('\n=== side-by-side ('+refRaw.length+' ref pts) ===')
fmt(envData,'envelope')
fmt(marchData,'marching')

// neck-hollow region: biggest envelope-vs-marching gap
const mbinLeft=new Float64Array(200).fill(Infinity)
for(const p of closedLoop){const bi=Math.max(0,Math.min(199,Math.floor((p[1]-vMin)/(vMax-vMin)*200)));if(p[0]<mbinLeft[bi])mbinLeft[bi]=p[0]}
let md=0,mdv=0
for(let bi=0;bi<200;bi++){const v=vMin+(bi+0.5)*(vMax-vMin)/200; if(mbinLeft[bi]>=Infinity)continue; const ei=Math.min(envLeft.length-1,Math.floor((v-vMin)/(vMax-vMin)*envLeft.length)); if(ei<0)continue; const d=Math.abs(mbinLeft[bi]-envLeft[ei][0]); if(d>md){md=d;mdv=v}}
console.log('\nmax envelope-vs-marching left gap:',md.toFixed(1),'mm at STL-Z=',mdv.toFixed(1))

// write CSVs
writeFileSync('scripts/out-marching-boundary.csv', closedLoop.map(p=>p[0].toFixed(2)+','+p[1].toFixed(2)).join('\n'))
writeFileSync('scripts/out-envelope-left.csv', envLeft.map(p=>p[0].toFixed(2)+','+p[1].toFixed(2)).join('\n'))
writeFileSync('scripts/out-ref-left.csv', refRaw.map(p=>p[0].toFixed(2)+','+(p[1]-bestOff).toFixed(2)).join('\n'))
console.log('\nCSVs written (ref-left has vOffset '+bestOff+' subtracted for overlay)')

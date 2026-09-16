// Determine exact STL -> G-code axis mapping at theta=0 by comparing the
// projected silhouette boundary against the golden .nc left profile.
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

// Build vertex positions array
const V = []
for (let i = 0; i < pos.count; i++) V.push({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) })

// Golden reference left profile at z=0
const gcode = parseGcode(readFileSync(NC, 'utf8'))
const ref = gcode.filter(m => m.z === 0 && m.x < -1 && m.x > -380)
  .map(m => ({ x: m.x, y: m.y }))

console.log('ref points:', ref.length)
console.log('ref x range:', ref.reduce((a,m)=>Math.min(a,m.x),1e9).toFixed(1), ref.reduce((a,m)=>Math.max(a,m.x),-1e9).toFixed(1))
console.log('ref y range:', ref.reduce((a,m)=>Math.min(a,m.y),1e9).toFixed(1), ref.reduce((a,m)=>Math.max(a,m.y),-1e9).toFixed(1))

// The .nc vertical (Y) clearly = STL Z. Horizontal = a projection of STL X&Y.
// Determine the mapping by checking silhouette min horizontal per vertical.
// Hypothesis: view along STL-Y (project onto X-Z plane): u=STL X, v=STL Z.
// But the model could be rotated in the STL so "front" faces a different way.

// Let's directly test: build a dense per-Z (height) min-X and min-Y envelope
// and see which matches the .nc left profile (which is the LEFT side, i.e. min horizontal).
// The .nc left X goes from -277 (bottom) to -3 (top). This is the min-horizontal at each height.

// Bin STL vertices by Z, find min X and min Y per bin and min of |X|,|Y| combos.
const zBins = {}
for (const v of V) {
  const zi = Math.round(v.z)
  if (!zBins[zi]) zBins[zi] = { minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9 }
  const b = zBins[zi]
  if (v.x < b.minX) b.minX = v.x
  if (v.x > b.maxX) b.maxX = v.x
  if (v.y < b.minY) b.minY = v.y
  if (v.y > b.maxY) b.maxY = v.y
}

// Compare: for the .nc left profile, x ranges -277..-3 (all negative, so it's one side).
// STL minX ranges -188..188 (could be either side depending on view), minY -190..190.
// Neither is "all negative". So the .nc LEFT side = the projected shadow's left boundary,
// which is the real silhouette edge, NOT the axis-aligned min. This confirms concavity matters.

// Key question: which STL axis is "up" (= .nc Y vertical)?
// STL Z spans 0..621.5, .nc Y spans 30..652 (span 622).  => STL Z = .nc Y. Confirmed.
// STL X spans -188..188, STL Y spans -190..190. The .nc X spans -277..-3.
// -277 < -188, so the .nc left silhouette is WIDER than the STL X extent alone.
// This means the silhouette at theta=0 is the projection onto the plane spanned by
// (STL Z = vertical) x (some horizontal that mixes STL X and STL Y), and the model
// is oriented diagonally so its silhouette extends to -277.

// Determine the rotation about Z (STL's vertical) that produces a left boundary reaching -277.
// The silhouette's horizontal extent = |X|*|cos phi| + |Y|*|sin phi| for the horizontal axis.
// max horizontal half-width needed ~ 277. With X half 188, Y half 190,
// max = hypot(188,190) = 267, still < 277. Close but the knight's diagonal corners
// reach farther. So a specific phi rotation about Z exists.

// Instead of guessing phi, compute it: the silhouette left boundary at theta=0 is the
// min over the projection along some horizontal direction. Let's find the direction
// (azimuth phi about Z) that maximizes/minimizes the silhouette to match -277.

function silhouetteMinHorizontal(phiDeg) {
  // project all vertices onto horizontal direction + Z vertical
  const rad = phiDeg * Math.PI / 180
  const c = Math.cos(rad), s = Math.sin(rad)
  let best = {} // per Z, min projected H
  const map = {}
  for (const v of V) {
    const h = v.x * c + v.y * s // horizontal along direction phi
    const zi = Math.round(v.z)
    if (!map[zi] || h < map[zi]) map[zi] = h
  }
  return map
}

// The .nc left profile is the min-horizontal SILHOUETTE (concave-aware), not vertex min.
// But for finding phi, the leftmost point at the base (y~30, x~-277) is a good anchor.
// Base of model = Z~0 (feet). Let's find the silhouette min-horizontal at Z=0.
const baseRef = ref.filter(m => m.y < 60)
console.log('\nref near base (y<60):', baseRef.map(m=>'('+m.x.toFixed(1)+','+m.y.toFixed(1)+')').join(' '))

// For each phi, compute the min horizontal among ALL vertices at the very base (z<10):
function baseMinH(phiDeg) {
  const rad = phiDeg * Math.PI / 180
  const c = Math.cos(rad), s = Math.sin(rad)
  let m = 1e9
  for (const v of V) {
    if (v.z > 10) continue
    const h = v.x * c + v.y * s
    if (h < m) m = h
  }
  return m
}

// scan phi
for (let phi = 0; phi <= 180; phi += 5) {
  const m = baseMinH(phi)
  console.log('phi', phi, '-> base min horizontal', m.toFixed(1))
}

// Also check the max horizontal equals ~+390 (right side lead)
console.log('\nref right-ish (x>0 y<60):', ref.filter(m=>m.y<60 && m.x>0).map(m=>m.x.toFixed(1)).join(' '))

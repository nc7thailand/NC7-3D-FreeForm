// Generate an SVG of the red silhouette polyline(s) at theta=90° (cut 5/8),
// in 2D u/v coordinates, using the production functions directly.
//
// Two renderings, per the user's request (both), overlaid in one SVG:
//   1. "2D wire path"  = buildSectionProfile + wirePathFromProfile (Method-1 left cut)
//   2. "3D shadow"     = projectShadowOutline (the full shadow-plane outline)
import { readFileSync, writeFileSync } from 'node:fs'
import * as THREE from 'three'
import { orientGeometryUp } from '../src/lib/stl.js'
import { buildSectionProfile, cuttingPlane, planePointFromStock } from '../src/lib/toolpath.js'
import { wirePathFromProfile } from '../src/lib/wirePath.js'
import { projectShadowOutline, shadowPlaneFor } from '../src/lib/shadowProjection.js'

const STL = 'Example/DevFoamExample/Preview.stl'
const THETA = 90 // rotation 5/8 of 8 cuts (index 4 * 22.5°)

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

const geo = orientGeometryUp(parseSTL(readFileSync(STL)))
const stock = { w: 387, t: 390, h: 627, lo: 5, bo: 1, kerf: 2, topOffset: 20 }

// --- 2D wire path (Method-1 left cut) ---
const planePoint = planePointFromStock(stock)
const profile = buildSectionProfile(geo, THETA, planePoint, null, { profileAccuracy: 5 })
const wire = wirePathFromProfile(profile, stock, THETA)

// --- 3D shadow overlay (full outline) ---
const plane = shadowPlaneFor(geo, THETA, 160)
const shadow = projectShadowOutline(geo, plane) // outline is flat [u,v,u,v,...]
const shadowPts = []
for (let i = 0; i < shadow.outline.length; i += 2) {
  shadowPts.push({ u: shadow.outline[i], v: shadow.outline[i+1] })
}

// --- collect all points for bounds ---
const all = [
  ...wire.map(p => [p.u, p.v]),
  ...shadowPts.map(p => [p.u, p.v]),
]
let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
for (const [u, v] of all) {
  if (u < minU) minU = u; if (u > maxU) maxU = u
  if (v < minV) minV = v; if (v > maxV) maxV = v
}
const pad = 20
minU -= pad; maxU += pad; minV -= pad; maxV += pad

// --- SVG sizing (map u->x, v->y with v inverted so up = +v) ---
const W = 1000
const H = 800
const sx = (u) => ((u - minU) / (maxU - minU)) * W
const sy = (v) => H - ((v - minV) / (maxV - minV)) * H

function path(points) {
  if (points.length === 0) return ''
  let d = `M ${sx(points[0].u).toFixed(2)} ${sy(points[0].v).toFixed(2)}`
  for (let i = 1; i < points.length; i++) {
    d += ` L ${sx(points[i].u).toFixed(2)} ${sy(points[i].v).toFixed(2)}`
  }
  if (points.length > 2) d += ' Z'
  return d
}

const wirePath = path(wire)
const shadowPath = path(shadowPts)

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#101418"/>
  <!-- 3D shadow overlay: full silhouette (grey, dashed) -->
  <path d="${shadowPath}" fill="none" stroke="#d05050" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.6"/>
  <!-- 2D wire path: Method-1 left cut (red, solid) -->
  <path d="${wirePath}" fill="none" stroke="#ff2020" stroke-width="2.5"/>
  <text x="16" y="24" fill="#e0e0e0" font-family="monospace" font-size="14">θ = ${THETA}° · cut 5/8 · u/v space (up = +v)</text>
  <text x="16" y="44" fill="#ff6060" font-family="monospace" font-size="12">solid = 2D wire path (left cut, ${wire.length} pts)</text>
  <text x="16" y="62" fill="#d07070" font-family="monospace" font-size="12">dashed = 3D shadow outline (full, ${shadowPts.length} pts)</text>
</svg>`

writeFileSync('scripts/silhouette-theta90.svg', svg)
console.log('wrote scripts/silhouette-theta90.svg')
console.log('wire pts:', wire.length, ' shadow pts:', shadowPts.length)
console.log('bounds u:', minU.toFixed(1), '..', maxU.toFixed(1), ' v:', minV.toFixed(1), '..', maxV.toFixed(1))

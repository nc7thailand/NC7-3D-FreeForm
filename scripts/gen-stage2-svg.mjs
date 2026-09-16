// Stage 2 ONLY — vector boolean split of the closed silhouette loop at the
// rotation axis (the "paper middle line", u = 0).
//
// Takes the Stage 1 raw closed contour (extractFullSilhouette, middle anchor,
// so u = 0 is the rotary axis) and clips it with the u ≤ 0 / u ≥ 0 half-planes.
// This is a proper Sutherland–Hodgman half-plane clip: every segment that
// crosses the axis is cut at its exact intersection, so both halves have true
// vertices ON the axis — not a point filter, not a sort.
//
// Output: two SVGs, each half drawn as an open polyline with vertices on the
// axis, plus a combined overlay for reference.
import { readFileSync, writeFileSync } from 'node:fs'
import * as THREE from 'three'
import { orientGeometryUp } from '../src/lib/stl.js'
import { extractFullSilhouette } from '../src/lib/silhouette.js'
import { cuttingPlane, planePointMiddleFromStock } from '../src/lib/toolpath.js'

const STL = 'Example/DevFoamExample/Preview.stl'
const THETA = 90 // keep consistent with Stage 1
const ACCURACY = 5 // keep consistent with Stage 1

function parseSTL(buf) {
  const tc = buf.readUInt32LE(80)
  const positions = new Float32Array(tc * 9)
  const index = new Uint32Array(tc * 3)
  let off = 84
  for (let t = 0; t < tc; t++) {
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
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setIndex(new THREE.BufferAttribute(index, 1))
  return g
}

// --- Extract the Stage 1 closed loop (middle anchor) ---
const geo = orientGeometryUp(parseSTL(readFileSync(STL)))
const frame = cuttingPlane(THETA, planePointMiddleFromStock())
const contour = extractFullSilhouette(geo, frame, { profileAccuracy: ACCURACY })
console.log('Stage 1 closed loop:', contour.length, 'pts')

// extractFullSilhouette projects with a frame whose anchor is `frame.point`.
// We built `frame` with the middle anchor (0,0,0), so u=0 is the rotary axis.
// (buildFullSilhouettePreview does the same then re-shifts; using the middle
// anchor directly is equivalent and avoids the extra hop.)

// Intersection of segment (a→b) with the vertical line u = 0, param t in [0,1].
function intersectU0(a, b) {
  const du = b.u - a.u
  const t = Math.abs(du) < 1e-12 ? 0 : (0 - a.u) / du
  return { u: 0, v: a.v + t * (b.v - a.v) }
}

function dedupe(pts, tol = 1e-6) {
  const out = []
  for (const p of pts) {
    const prev = out[out.length - 1]
    if (!prev || Math.hypot(p.u - prev.u, p.v - prev.v) > tol) out.push(p)
  }
  return out
}

// Vector boolean half-plane split of a CLOSED loop at u = 0.
//
// Returns the kept side as an OPEN polyline whose first and last vertices lie
// ON the axis: [axisCrossA, ...interior points..., axisCrossB]. We locate the
// two ring segments that cross the axis, walk the ring's kept run between them,
// and prepend/append the exact axis intersection points. This preserves the
// original d3-contour ordering (no sort) and cuts precisely at the axis (no
// point filter).
function splitAtAxis(loop, keep, label) {
  const n = loop.length
  if (n < 3) return []

  // 1. find crossing segments: i -> i+1 where keep flips
  const cross = []
  for (let i = 0; i < n; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % n]
    if (keep(a) !== keep(b)) cross.push({ i, a, b, aIn: keep(a) })
  }

  // A convex-ish silhouette crosses the axis exactly twice -> two crossings.
  if (cross.length !== 2) {
    console.warn(`${label}: expected 2 axis crossings, got ${cross.length}`)
    if (cross.length === 0) return []
  }

  // Orientation: find the crossing that ENTERS the kept side (a not-kept -> b kept).
  const enter = cross.find((c) => !c.aIn)
  const exit = cross.find((c) => c.aIn)
  if (!enter || !exit) return []

  // Walk the kept run from enter (inclusive of the point after enter) to exit
  // (inclusive of the point before exit). Ring indices increase mod n.
  const pts = []
  const enterPoint = intersectU0(enter.a, enter.b)
  pts.push(enterPoint)

  // interior kept points: from enter.i + 1 to exit.i (mod n)
  let idx = (enter.i + 1) % n
  while (true) {
    if (idx === exit.i) {
      // include exit.a only if it is strictly inside the kept side (it is,
      // since exit is a kept->culled crossing, so exit.a is kept)
      if (keep(loop[idx])) pts.push(loop[idx])
      break
    }
    pts.push(loop[idx])
    idx = (idx + 1) % n
  }

  const exitPoint = intersectU0(exit.a, exit.b)
  pts.push(exitPoint)

  return dedupe(pts)
}

// LEFT half: u <= 0  (inclusive boundary)
// RIGHT half: u > 0  (strict boundary — the on-axis vertex belongs to LEFT only)
const leftHalf = splitAtAxis(contour, (p) => p.u <= 0, 'LEFT')
const rightHalf = splitAtAxis(contour, (p) => p.u > 0, 'RIGHT')

console.log('LEFT  half:', leftHalf.length, 'pts')
console.log('RIGHT half:', rightHalf.length, 'pts')

// --- SVG rendering helpers ---
function boundsOf(arrays) {
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
  for (const arr of arrays) {
    for (const p of arr) {
      if (p.u < minU) minU = p.u
      if (p.u > maxU) maxU = p.u
      if (p.v < minV) minV = p.v
      if (p.v > maxV) maxV = p.v
    }
  }
  return { minU, maxU, minV, maxV }
}

function renderSvg(title, subtitle, polylines, opts = {}) {
  const { minU, maxU, minV, maxV } = boundsOf(polylines)
  const pad = 20
  const b = { u0: minU - pad, u1: maxU + pad, v0: minV - pad, v1: maxV + pad }
  const W = 1000
  const H = 800
  const sx = (u) => ((u - b.u0) / (b.u1 - b.u0)) * W
  const sy = (v) => H - ((v - b.v0) / (b.v1 - b.v0)) * H

  let body = ''
  // axis line at u = 0
  body += `<line x1="${sx(0).toFixed(2)}" y1="${sy(b.v0).toFixed(2)}" x2="${sx(0).toFixed(2)}" y2="${sy(b.v1).toFixed(2)}" stroke="#3a6ea5" stroke-width="1" stroke-dasharray="6 4"/>`
  // axis point markers (where the loop crosses the axis)
  for (const arr of polylines) {
    for (const p of arr) {
      if (Math.abs(p.u) < 1e-6) {
        body += `<circle cx="${sx(p.u).toFixed(2)}" cy="${sy(p.v).toFixed(2)}" r="3" fill="#3a6ea5"/>`
      }
    }
  }
  for (const arr of polylines) {
    if (!arr.length) continue
    let d = `M ${sx(arr[0].u).toFixed(2)} ${sy(arr[0].v).toFixed(2)}`
    for (let i = 1; i < arr.length; i++) {
      d += ` L ${sx(arr[i].u).toFixed(2)} ${sy(arr[i].v).toFixed(2)}`
    }
    body += `<path d="${d}" fill="none" stroke="${opts.stroke || '#ff2020'}" stroke-width="${opts.width || 2}"/>`
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#101418"/>
  ${body}
  <text x="16" y="24" fill="#e0e0e0" font-family="monospace" font-size="14">${title}</text>
  <text x="16" y="44" fill="#808080" font-family="monospace" font-size="12">${subtitle}</text>
</svg>`
}

// Left half SVG (open polyline)
const leftSvg = renderSvg(
  `Stage 2 — LEFT half · θ = ${THETA}° · ${leftHalf.length} pts`,
  'u ≤ 0 · open polyline, vertices on axis · vector boolean clip (no filter, no sort)',
  [leftHalf]
)
writeFileSync('scripts/stage2-left-half.svg', leftSvg)
console.log('wrote scripts/stage2-left-half.svg')

// Right half SVG (open polyline)
const rightSvg = renderSvg(
  `Stage 2 — RIGHT half · θ = ${THETA}° · ${rightHalf.length} pts`,
  'u > 0 · open polyline, vertices on axis · vector boolean clip (no filter, no sort)',
  [rightHalf],
  { stroke: '#39d353', width: 2 }
)
writeFileSync('scripts/stage2-right-half.svg', rightSvg)
console.log('wrote scripts/stage2-right-half.svg')

// Combined overlay for reference
const overlaySvg = renderSvg(
  `Stage 2 — combined · left ${leftHalf.length} + right ${rightHalf.length} = ${leftHalf.length + rightHalf.length} pts`,
  'red = left (u≤0) · green = right (u≥0) · blue dashed = axis u=0',
  [leftHalf, rightHalf],
  {}
)
// recolor: left red, right green — render separately
const leftOverlay = renderSvg('', '', [leftHalf], { stroke: '#ff2020', width: 2 })
const rightOverlay = renderSvg('', '', [rightHalf], { stroke: '#39d353', width: 2 })
// simpler: build one svg with both strokes inline
function renderOverlay() {
  const { minU, maxU, minV, maxV } = boundsOf([leftHalf, rightHalf])
  const pad = 20
  const b = { u0: minU - pad, u1: maxU + pad, v0: minV - pad, v1: maxV + pad }
  const W = 1000, H = 800
  const sx = (u) => ((u - b.u0) / (b.u1 - b.u0)) * W
  const sy = (v) => H - ((v - b.v0) / (b.v1 - b.v0)) * H
  const pathD = (arr) => {
    if (!arr.length) return ''
    let d = `M ${sx(arr[0].u).toFixed(2)} ${sy(arr[0].v).toFixed(2)}`
    for (let i = 1; i < arr.length; i++) d += ` L ${sx(arr[i].u).toFixed(2)} ${sy(arr[i].v).toFixed(2)}`
    return d
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#101418"/>
  <line x1="${sx(0).toFixed(2)}" y1="${sy(b.v0).toFixed(2)}" x2="${sx(0).toFixed(2)}" y2="${sy(b.v1).toFixed(2)}" stroke="#3a6ea5" stroke-width="1" stroke-dasharray="6 4"/>
  <path d="${pathD(leftHalf)}" fill="none" stroke="#ff2020" stroke-width="2"/>
  <path d="${pathD(rightHalf)}" fill="none" stroke="#39d353" stroke-width="2"/>
  <text x="16" y="24" fill="#e0e0e0" font-family="monospace" font-size="14">Stage 2 — combined overlay · left ${leftHalf.length} + right ${rightHalf.length} pts</text>
  <text x="16" y="44" fill="#808080" font-family="monospace" font-size="12">red = left (u≤0) · green = right (u>0) · blue dashed = axis u=0</text>
</svg>`
}
writeFileSync('scripts/stage2-overlay.svg', renderOverlay())
console.log('wrote scripts/stage2-overlay.svg')

// Report axis-crossing vertices
const axisPts = [...leftHalf, ...rightHalf].filter((p) => Math.abs(p.u) < 1e-6)
console.log('axis-crossing vertices (v values):', axisPts.map((p) => p.v.toFixed(1)).join(', '))

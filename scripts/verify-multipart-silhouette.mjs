// P1 smoke test: multi-mesh shadow-grid union vs single mesh baseline.
// Usage: node scripts/verify-multipart-silhouette.mjs
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { geometryToCutPart } from '../src/lib/cutParts.js'
import { buildSectionProfileFromParts } from '../src/lib/toolpath.js'
import { orientGeometryUp } from '../src/lib/stl.js'

const STL = 'Example/DevFoamExample/Preview.stl'

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
  return geo
}

function makeBox(w, h, d, x, y, z) {
  const geo = new THREE.BoxGeometry(w, h, d)
  geo.translate(x, y + h / 2, z)
  return geo
}

function profileWidth(profile) {
  const poly = profile?.polylines?.[0] ?? []
  if (poly.length < 2) return 0
  let uMin = Infinity
  let uMax = -Infinity
  for (const p of poly) {
    uMin = Math.min(uMin, p.u)
    uMax = Math.max(uMax, p.u)
  }
  return uMax - uMin
}

const artwork = orientGeometryUp(parseSTL(readFileSync(STL)))
artwork.computeBoundingBox()
const bb = artwork.boundingBox
const cx = (bb.min.x + bb.max.x) / 2
const cz = (bb.min.z + bb.max.z) / 2

const basePlate = makeBox(bb.max.x - bb.min.x + 40, 8, bb.max.z - bb.min.z + 40, cx, -4, cz)
const bridge = makeBox(20, 40, 20, cx, bb.max.y + 20, cz)

const planePoint = new THREE.Vector3(0, 0, -200)
const opts = { profileAccuracy: 5 }

const solo = buildSectionProfileFromParts(
  [geometryToCutPart(artwork, { role: 'artwork' })],
  0,
  planePoint,
  opts,
)
const combined = buildSectionProfileFromParts(
  [
    geometryToCutPart(artwork, { role: 'artwork' }),
    geometryToCutPart(basePlate, { role: 'helper-base' }),
    geometryToCutPart(bridge, { role: 'helper-bridge' }),
  ],
  0,
  planePoint,
  opts,
)
const excluded = buildSectionProfileFromParts(
  [
    geometryToCutPart(artwork, { role: 'artwork' }),
    geometryToCutPart(basePlate, { role: 'helper-base', includeInCut: false }),
  ],
  0,
  planePoint,
  opts,
)

const soloPts = solo.pointCount
const combinedPts = combined.pointCount
const excludedPts = excluded.pointCount
const soloW = profileWidth(solo)
const combinedW = profileWidth(combined)

let failed = false
if (soloPts < 2) {
  console.log('[FAIL] solo profile empty')
  failed = true
}
if (combinedW <= soloW + 1) {
  console.log('[FAIL] combined profile width should exceed solo when base plate is included')
  failed = true
}
if (Math.abs(profileWidth(excluded) - soloW) > 0.5) {
  console.log('[FAIL] includeInCut:false helper changed profile width unexpectedly')
  failed = true
}

if (!failed) {
  console.log('[PASS] multi-mesh silhouette union')
  console.log(`  solo: ${soloPts} pts, width ${soloW.toFixed(1)} mm`)
  console.log(`  combined (artwork+base+bridge): ${combinedPts} pts, width ${combinedW.toFixed(1)} mm`)
  console.log(`  excluded helper: ${excludedPts} pts (matches solo)`)
}

process.exit(failed ? 1 : 0)

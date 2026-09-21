// G-code identity harness: dump the shipped pipeline's G-code for the golden
// model so two branches can be compared byte-for-byte.
//
// Usage: node scripts/dump-gcode.mjs > /tmp/gcode.json
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { orientGeometryUp } from '../src/lib/stl.js'
import { planePointFromStock } from '../src/lib/toolpath.js'
import { buildCutJob, CUT_MODE_LEFT_TO_RIGHT, CUT_MODE_LEFT_ONLY } from '../src/lib/cutJob.js'
import { wirePathFromProfile } from '../src/lib/wirePath.js'
import { attachIndexSafetyToJob } from '../src/lib/indexSafety.js'
import { generateGcode, DEFAULT_GCODE_SETTINGS } from '../src/lib/gcode.js'

const STL = 'Example/DevFoamExample/Preview.stl'

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

const STOCK = {
  w: 400, t: 400, h: 650, lo: 5, bo: 1, kerf: 2,
  topOffset: 20, boAuto: true, boMargin: 20,
  showModelBBox: true, profileAccuracy: 5,
}

const geo = orientGeometryUp(parseSTL(readFileSync(STL)))
// Match AppState's prep: centre X/Z, drop onto the floor.
geo.computeBoundingBox()
const c = geo.boundingBox.getCenter(new THREE.Vector3())
geo.translate(-c.x, -c.y, -c.z)
geo.computeBoundingBox()
geo.translate(0, -geo.boundingBox.min.y, 0)
geo.computeBoundingBox()

const planePoint = planePointFromStock(STOCK)
const out = {}

for (const [label, mode] of [
  ['left-to-right', CUT_MODE_LEFT_TO_RIGHT],
  ['left-only', CUT_MODE_LEFT_ONLY],
]) {
  const job = await buildCutJob(geo, 16, planePoint, {
    mode,
    silhouetteOpts: { profileAccuracy: 5 },
  })
  job.stock = { ...STOCK }
  for (const cut of job.cuts) {
    cut.wirePath = wirePathFromProfile(cut.profile, STOCK, cut.thetaDeg)
  }
  attachIndexSafetyToJob(job, geo, STOCK, mode)
  const program = generateGcode({ ...job, stock: STOCK }, DEFAULT_GCODE_SETTINGS)
  out[label] = {
    cutCount: job.cutCount,
    pointCounts: job.cuts.map((c) => c.profile.pointCount),
    lineCount: program.lineCount,
    gcode: program.program,
  }
}

process.stdout.write(JSON.stringify(out, null, 1))

import * as THREE from 'three'
import { buildCutJob, CUT_MODE_LEFT_ONLY } from '../src/lib/cutJob.js'
import { runToolpathPipeline } from '../src/lib/camPipeline.js'
import { importSizeError, MAX_IMPORT_BYTES, meshImportKind } from '../src/lib/importLimit.js'
import { resolveToolpathDisplayGeometry, TOOLPATH_PROXY_MAX_TRIANGLES } from '../src/lib/meshProxy.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const exact = importSizeError({ name: 'ok.stl', size: MAX_IMPORT_BYTES })
assert(exact === null, 'a file of exactly 5 MB must be accepted')

const over = importSizeError({ name: 'big.stl', size: MAX_IMPORT_BYTES + 1 })
assert(typeof over === 'string' && over.includes('5 MB'), 'a file over 5 MB must be rejected before parse')
assert(meshImportKind('Part.3MF') === '3mf', '3mf extension')
assert(meshImportKind('Part.STL') === 'stl', 'stl extension')
assert(meshImportKind('job.nc7project') === null, 'project files are not mesh imports')

const geo = new THREE.BoxGeometry(10, 20, 30).toNonIndexed()
geo.computeVertexNormals()
const sourceMarker = geo.attributes.position.array[0]

let clones = 0
const origClone = THREE.BufferGeometry.prototype.clone
THREE.BufferGeometry.prototype.clone = function () {
  clones += 1
  return origClone.call(this)
}

const stock = {
  w: 40,
  t: 40,
  h: 40,
  lo: 5,
  bo: 1,
  kerf: 1,
  profileAccuracy: 5,
  boAuto: false,
}

try {
  const job = await runToolpathPipeline(geo, {
    rotationN: 8,
    stock,
    cutMode: CUT_MODE_LEFT_ONLY,
    planePoint: new THREE.Vector3(0, 0, -20),
  })
  assert(job?.cuts?.length === 8, `expected 8 cuts, got ${job?.cuts?.length}`)
  assert(job.cuts.every((cut) => Array.isArray(cut.overlayContour)), 'overlay missing')
  assert(clones <= 1, `toolpath cloned the mesh ${clones} times across 8 angles`)
  assert(geo.attributes.position.array[0] === sourceMarker, 'source mesh was mutated or disposed')
  assert(job.sourceGeometryUuid === geo.uuid, 'job must keep the source uuid')
} finally {
  THREE.BufferGeometry.prototype.clone = origClone
}

const densePositions = new Float32Array(30_000 * 9)
for (let i = 0; i < densePositions.length; i++) densePositions[i] = (i % 97) * 0.05
const dense = new THREE.BufferGeometry()
dense.setAttribute('position', new THREE.BufferAttribute(densePositions, 3))
const display = resolveToolpathDisplayGeometry(dense)
assert(display.owned === true, 'dense mesh should use an owned display proxy')
assert(
  (display.geometry.index ? display.geometry.index.count / 3 : display.geometry.attributes.position.count / 3)
    <= TOOLPATH_PROXY_MAX_TRIANGLES,
  'display proxy exceeded 24,000 triangles',
)
display.geometry.dispose()
assert(dense.attributes.position, 'proxy build disposed the source mesh')

const small = new THREE.BoxGeometry(1, 1, 1)
const smallDisplay = resolveToolpathDisplayGeometry(small)
assert(smallDisplay.owned === false && smallDisplay.geometry === small, 'small mesh must be shown directly')

console.log(`verify-memory-opt ok (clones during 8-angle job: ${clones})`)

import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { cutAnglesForN } from '../src/lib/cutJob.js'
import { cuttingPlane } from '../src/lib/toolpath.js'
import { encodeGeometryForNative, resolveCamBackend } from '../src/lib/camBackend.js'
import { computeToolpathInWorker } from '../src/lib/camWorkerClient.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function closeTo(actual, expected, label) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > 1e-9) {
    throw new Error(`${label}: ${actual} vs ${expected}`)
  }
}

function assertBackendSelection() {
  function WorkerStub() {}
  const webview = { postMessage() {}, addEventListener() {} }

  assert(resolveCamBackend({ Worker: WorkerStub }) === 'worker', 'browser without WebView2 uses the worker')
  assert(resolveCamBackend({}) === 'main', 'no worker falls back to the main thread')
  assert(resolveCamBackend({ Worker: WorkerStub, __NC7_CAM_BACKEND__: 'main' }) === 'main', 'explicit main override')
  assert(resolveCamBackend({ Worker: WorkerStub, __NC7_CAM_BACKEND__: 'native' }) === 'native', 'explicit native override')
  assert(resolveCamBackend({ Worker: WorkerStub, __NC7_CAM_BACKEND__: 'wasm' }) === 'worker', 'unknown override is ignored')
  assert(resolveCamBackend({
    Worker: WorkerStub,
    chrome: { webview },
    __NC7_NATIVE_CAM__: { productionReady: false, engine: 'native-skeleton' },
  }) === 'worker', 'skeleton host keeps the worker')
  assert(resolveCamBackend({
    Worker: WorkerStub,
    chrome: { webview },
    __NC7_NATIVE_CAM__: { productionReady: true, engine: 'native' },
  }) === 'native', 'production-ready WebView2 host uses native')
  assert(resolveCamBackend({
    Worker: WorkerStub,
    chrome: { webview: {} },
    __NC7_NATIVE_CAM__: { productionReady: true },
  }) === 'worker', 'webview without postMessage is not a transport')
}

function startService(bin) {
  const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  let buffer = ''
  let stderr = ''
  const backlog = []
  const listeners = []

  function fail(error) {
    for (const listener of listeners.splice(0)) listener.reject(error)
  }

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let nl = buffer.indexOf('\n')
    while (nl >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '')
      buffer = buffer.slice(nl + 1)
      nl = buffer.indexOf('\n')
      if (!line.trim()) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch (err) {
        fail(new Error(`invalid JSON from CAM service: ${line}\n${err.message}`))
        return
      }
      let handled = false
      for (let i = 0; i < listeners.length; i++) {
        const answer = listeners[i].predicate(msg)
        if (answer === 'keep') {
          handled = true
          break
        }
        if (answer) {
          const [listener] = listeners.splice(i, 1)
          listener.resolve(msg)
          handled = true
          break
        }
      }
      if (!handled) backlog.push(msg)
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  child.on('error', (err) => fail(err))

  function onceMessage(predicate, timeoutMs = 8000) {
    const existing = backlog.findIndex(predicate)
    if (existing >= 0) return Promise.resolve(backlog.splice(existing, 1)[0])
    return new Promise((resolve, reject) => {
      const listener = { predicate, resolve: null, reject: null }
      const timer = setTimeout(() => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
        reject(new Error(`timeout waiting for CAM message\nstderr: ${stderr}\nbuffer: ${buffer}`))
      }, timeoutMs)
      listener.resolve = (msg) => {
        clearTimeout(timer)
        resolve(msg)
      }
      listener.reject = (err) => {
        clearTimeout(timer)
        reject(err)
      }
      listeners.push(listener)
    })
  }

  function send(obj) {
    child.stdin.write(`${JSON.stringify(obj)}\n`)
  }

  function request(obj, timeoutMs = 8000) {
    const progress = []
    const result = onceMessage((msg) => {
      if (msg.id !== obj.id) return false
      if (msg.type === 'progress') {
        progress.push(msg)
        return 'keep'
      }
      return true
    }, timeoutMs).then((message) => ({ progress, result: message }))
    send(obj)
    return result
  }

  return {
    hello: onceMessage((msg) => msg.type === 'hello'),
    onceMessage,
    request,
    sendRaw(line) {
      child.stdin.write(`${line}\n`)
    },
    stderr: () => stderr,
    async close() {
      child.stdin.end()
      const killer = setTimeout(() => child.kill(), 1000)
      await once(child, 'exit')
      clearTimeout(killer)
    },
  }
}

function assertProgress(progress, total) {
  assert(progress.length === total, `expected ${total} progress events, got ${progress.length}`)
  progress.forEach((event, index) => {
    assert(event.done === index + 1, `progress done ${event.done} at ${index}`)
    assert(event.total === total, `progress total ${event.total}`)
    assert(event.channel === 'nc7-cam', 'progress channel')
  })
}

function assertFrames(job, planePoint) {
  const angles = cutAnglesForN(job.rotationN, { mode: job.mode })
  assert(job.cuts.length === angles.length, `cut count ${job.cuts.length} vs ${angles.length}`)
  const anchor = new THREE.Vector3(planePoint[0], planePoint[1], planePoint[2])
  for (const cut of job.cuts) {
    closeTo(cut.thetaDeg, angles[cut.index], `theta ${cut.index}`)
    const frame = cuttingPlane(cut.thetaDeg, anchor)
    closeTo(cut.profile.frame.normal.x, frame.normal.x, `normal.x ${cut.index}`)
    closeTo(cut.profile.frame.normal.y, frame.normal.y, `normal.y ${cut.index}`)
    closeTo(cut.profile.frame.normal.z, frame.normal.z, `normal.z ${cut.index}`)
    closeTo(cut.profile.frame.uAxis.x, frame.uAxis.x, `uAxis.x ${cut.index}`)
    closeTo(cut.profile.frame.uAxis.y, frame.uAxis.y, `uAxis.y ${cut.index}`)
    closeTo(cut.profile.frame.uAxis.z, frame.uAxis.z, `uAxis.z ${cut.index}`)
    closeTo(cut.profile.frame.point.x, anchor.x, `point.x ${cut.index}`)
    closeTo(cut.profile.frame.point.y, anchor.y, `point.y ${cut.index}`)
    closeTo(cut.profile.frame.point.z, anchor.z, `point.z ${cut.index}`)
    assert(cut.profile.source === 'native-skeleton', 'profile source')
    assert(cut.profile.polylines.length === 1, 'profile polyline')
    assert(cut.profile.pointCount === cut.profile.polylines[0].length, 'pointCount')
    assert(cut.overlayContour.length >= 2, 'overlay contour')
  }
}

assertBackendSelection()

const mainGeo = new THREE.BoxGeometry(10, 20, 30)
const mainJob = await computeToolpathInWorker(mainGeo, {
  rotationN: 4,
  stock: { w: 40, t: 40, h: 40, lo: 5, bo: 1, kerf: 1, profileAccuracy: 5 },
  cutMode: 'left-only',
})
assert(resolveCamBackend() === 'main', 'this runtime has no worker, so the client uses main')
assert(mainJob?.camBackend === 'main', 'main-thread job records its backend')
assert(mainJob.cuts.length === 4, `main-thread client returned ${mainJob?.cuts?.length} cuts`)
assert(mainJob.cuts.some((cut) => cut.profile?.polylines?.length > 0), 'main-thread profile')
assert(mainJob.cuts.every((cut) => cut.overlayContour?.length >= 2), 'main-thread overlay')
mainGeo.dispose()

execFileSync('make', ['-C', path.join(root, 'host/native/NC7CamService')], { stdio: 'inherit' })

const bin = [
  path.join(root, 'host/native/NC7CamService/build/nc7-cam-service'),
  path.join(root, 'host/native/NC7CamService/build/nc7-cam-service.exe'),
].find((candidate) => fs.existsSync(candidate))
assert(bin, 'nc7-cam-service binary was not produced')

const service = startService(bin)
try {
  const hello = await service.hello
  assert(hello.channel === 'nc7-cam', 'hello channel')
  assert(hello.protocolVersion === 1, 'protocol version')
  assert(hello.engine === 'native-skeleton', 'skeleton engine')
  assert(hello.productionReady === false, 'skeleton is not production ready')
  assert(hello.actions.includes('computeToolpath'), 'computeToolpath is advertised')
  assert(!hello.actions.includes('compileGcode'), 'gcode stays on the worker')

  const brokenPromise = service.onceMessage((msg) => msg.type === 'result' && msg.status === 'error' && msg.id == null)
  service.sendRaw('{')
  const broken = await brokenPromise
  assert(typeof broken.error === 'string' && broken.error.length > 0, 'malformed JSON should explain the failure')

  const badAction = await service.request({ id: 2, action: 'nope' })
  assert(badAction.result.status === 'error', 'nope should fail')
  assert(String(badAction.result.error).includes('Unknown action: nope'), badAction.result.error)

  const ping = await service.request({ id: 3, action: 'ping' })
  assert(ping.result.status === 'success' && ping.result.pong === true, 'ping after a bad line')

  const badPosition = await service.request({
    id: 4,
    action: 'computeToolpath',
    payload: {
      rotationN: 4,
      cutMode: 'left-only',
      stock: { t: 10 },
      geometry: { position: [1, 2, 3, 4] },
    },
  })
  assert(badPosition.result.status === 'error', 'bad position should fail')
  assert(String(badPosition.result.error).includes('multiple of 3'), badPosition.result.error)

  const triangle = await service.request({
    id: 5,
    action: 'computeToolpath',
    payload: {
      rotationN: 1,
      cutMode: 'left-to-right',
      stock: { t: 10, note: 'ipc', boAuto: false, profileAccuracy: 5 },
      geometry: {
        uuid: 'triangle-1',
        userData: { nc7ModelRevision: 4 },
        position: [0, -2, 0, -4, 3, 1, 2, 1, -1],
      },
    },
  })
  assert(triangle.result.status === 'success', triangle.result.error ?? 'triangle compute failed')
  const small = triangle.result.cutJob
  assert(small.rotationN === 3, `rotationN clamped to ${small.rotationN}`)
  assert(small.cutCount === 2, `left-to-right N=3 has ${small.cutCount} cuts`)
  assert(small.mode === 'left-to-right', small.mode)
  assert(small.stock.note === 'ipc', 'stock string should round-trip')
  assert(small.stock.boAuto === false, 'stock bool should round-trip')
  assert(small.stock.profileAccuracy === 5, 'stock number should round-trip')
  assert(small.sourceGeometryUuid === 'triangle-1', 'uuid')
  assert(small.sourceModelRevision === 4, 'revision')
  assert(small.overlayContourVersion === 2, 'overlay version')
  assertProgress(triangle.progress, 2)
  assertFrames(small, [0, 0, -5])

  const clamped = await service.request({
    id: 6,
    action: 'computeToolpath',
    payload: {
      rotationN: 100,
      cutMode: 'left-only',
      stock: { t: 10 },
      planePoint: [0, 0, -5],
      geometry: { position: [0, 0, 0, -4, 5, 1, 2, 3, -1] },
    },
  })
  assert(clamped.result.cutJob.rotationN === 64, 'rotationN clamps to 64')
  assert(clamped.result.cutJob.cutCount === 64, 'left-only keeps 64 cuts')
  assert(clamped.result.cutJob.mode === 'left-only', clamped.result.cutJob.mode)
  assertProgress(clamped.progress, 64)

  const geo = new THREE.BoxGeometry(10, 20, 30)
  geo.userData.nc7ModelRevision = 7
  const marker = geo.attributes.position.array[0]
  const encoded = encodeGeometryForNative(geo)
  assert(geo.attributes.position.array[0] === marker, 'encoding must not detach the mesh')
  assert(encoded.positionEncoding === 'base64-f32le', 'position encoding')
  assert(encoded.positionCount === geo.attributes.position.count * 3, 'position count')
  assert(encoded.indexCount === geo.getIndex().count, 'index count')

  const boxed = await service.request({
    id: 7,
    action: 'computeToolpath',
    payload: {
      geometry: encoded,
      rotationN: 16,
      cutMode: 'left-to-right',
      stock: { w: 40, t: 30, h: 40 },
      planePoint: [0, 0, -15],
    },
  })
  assert(boxed.result.status === 'success', boxed.result.error ?? 'box compute failed')
  assert(boxed.result.engine === 'native-skeleton', 'result engine')
  assert(boxed.result.vertexCount === geo.attributes.position.count, 'decoded vertex count')
  assert(boxed.result.triangleCount === geo.getIndex().count / 3, 'decoded triangle count')
  const job = boxed.result.cutJob
  assert(job.rotationN === 16, 'box rotationN')
  assert(job.cutCount === 8, 'left-to-right N=16 has 8 cuts')
  assert(job.sourceGeometryUuid === geo.uuid, 'box uuid')
  assert(job.sourceModelRevision === 7, 'box revision')
  assertProgress(boxed.progress, 8)
  assertFrames(job, [0, 0, -15])
  const profile = job.cuts[0].profile.polylines[0]
  assert(profile.every((point) => point.v >= -1e-6 && point.v <= 20 + 1e-6), 'floor-settled height')
  assert(profile.some((point) => point.u < 0), 'left profile has a negative u')
  geo.dispose()
} finally {
  await service.close()
}

console.log('cam ipc ok')

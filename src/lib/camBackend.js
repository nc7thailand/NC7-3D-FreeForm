/**
 * CAM backend selection and the WebView2 native IPC client.
 *
 * Backends:
 *   worker — camWorker.js (default in the browser)
 *   native — nc7-cam-service through window.chrome.webview
 *   main   — this thread, when no worker exists
 *
 * WebView2 is detected via window.chrome.webview. A skeleton host advertises
 * productionReady: false, so toolpaths stay on the worker until a native
 * engine can return the real silhouette. Set window.__NC7_CAM_BACKEND__ to
 * "native" to exercise the skeleton protocol anyway.
 */

export const CAM_CHANNEL = 'nc7-cam'
export const CAM_BACKENDS = ['worker', 'native', 'main']

const HELLO_TIMEOUT_MS = 5000

let requestId = 0
let listening = false
/** @type {Map<number, { resolve: Function, reject: Function, onProgress?: Function }>} */
const pending = new Map()
/** @type {Array<{ resolve: Function, reject: Function }>} */
let helloWaiters = []

function normalizeOverride(value) {
  return CAM_BACKENDS.includes(value) ? value : null
}

export function nativeCamTransport(scope = globalThis) {
  const webview = scope.chrome?.webview
  if (!webview) return null
  if (typeof webview.postMessage !== 'function') return null
  if (typeof webview.addEventListener !== 'function') return null
  return webview
}

/**
 * @param {typeof globalThis} [scope]
 * @returns {'worker' | 'native' | 'main'}
 */
export function resolveCamBackend(scope = globalThis) {
  const override = normalizeOverride(scope.__NC7_CAM_BACKEND__)
  if (override) return override
  const hello = scope.__NC7_NATIVE_CAM__
  if (nativeCamTransport(scope) && hello?.productionReady === true) return 'native'
  if (typeof scope.Worker === 'function') return 'worker'
  return 'main'
}

export function bytesToBase64(bytes) {
  const chunk = 0x4000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length))
    binary += String.fromCharCode.apply(null, slice)
  }
  return btoa(binary)
}

function typedBytes(view) {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
}

/**
 * JSON-safe geometry for the native process. Copies bytes into base64 and
 * leaves the source mesh buffer intact.
 *
 * @param {object|null} geometry
 */
export function encodeGeometryForNative(geometry) {
  if (!geometry?.getAttribute) return null
  const posAttr = geometry.getAttribute('position')
  if (!posAttr?.array?.length) return null

  const position = posAttr.array instanceof Float32Array
    ? posAttr.array
    : new Float32Array(posAttr.array)
  const indexAttr = geometry.getIndex?.() ?? null
  const index = indexAttr?.array
    ? (indexAttr.array instanceof Uint32Array ? indexAttr.array : new Uint32Array(indexAttr.array))
    : null

  return {
    uuid: geometry.uuid ?? null,
    userData: geometry.userData ? { ...geometry.userData } : {},
    positionEncoding: 'base64-f32le',
    position: bytesToBase64(typedBytes(position)),
    positionCount: position.length,
    indexEncoding: index ? 'base64-u32le' : null,
    index: index ? bytesToBase64(typedBytes(index)) : null,
    indexCount: index ? index.length : 0,
  }
}

function messageData(event) {
  const data = event?.data
  if (typeof data === 'string') {
    try {
      return JSON.parse(data)
    } catch {
      return null
    }
  }
  return data ?? null
}

function rejectPending(error) {
  const err = error instanceof Error ? error : new Error(String(error))
  for (const [, entry] of pending) entry.reject(err)
  pending.clear()
  const waiters = helloWaiters
  helloWaiters = []
  for (const waiter of waiters) waiter.reject(err)
}

function onNativeMessage(scope, event) {
  const msg = messageData(event)
  if (!msg || msg.channel !== CAM_CHANNEL) return

  if (msg.type === 'hello') {
    scope.__NC7_NATIVE_CAM__ = msg
    const waiters = helloWaiters
    helloWaiters = []
    for (const waiter of waiters) waiter.resolve(msg)
    return
  }

  if (msg.type === 'service-exit') {
    rejectPending(new Error(msg.error || 'Native CAM service exited'))
    return
  }

  const entry = pending.get(msg.id)
  if (!entry) return
  if (msg.type === 'progress') {
    entry.onProgress?.(msg.done, msg.total)
    return
  }
  pending.delete(msg.id)
  if (msg.status === 'success') entry.resolve(msg)
  else entry.reject(new Error(msg.error || 'Native CAM failed'))
}

function ensureListener(scope = globalThis) {
  const webview = nativeCamTransport(scope)
  if (!webview || listening) return webview
  listening = true
  webview.addEventListener('message', (event) => onNativeMessage(scope, event))
  return webview
}

export function whenNativeHello(scope = globalThis, timeoutMs = HELLO_TIMEOUT_MS) {
  const existing = scope.__NC7_NATIVE_CAM__
  if (existing?.protocolVersion) return Promise.resolve(existing)
  const webview = ensureListener(scope)
  if (!webview) return Promise.reject(new Error('Native CAM transport is not available'))

  return new Promise((resolve, reject) => {
    let timer
    const waiter = {
      resolve: (msg) => {
        clearTimeout(timer)
        resolve(msg)
      },
      reject: (err) => {
        clearTimeout(timer)
        reject(err)
      },
    }
    timer = setTimeout(() => {
      helloWaiters = helloWaiters.filter((item) => item !== waiter)
      reject(new Error('Native CAM host did not respond to hello'))
    }, timeoutMs)
    helloWaiters.push(waiter)
    try {
      webview.postMessage({ channel: CAM_CHANNEL, id: 0, action: 'hello' })
    } catch (err) {
      clearTimeout(timer)
      helloWaiters = helloWaiters.filter((item) => item !== waiter)
      reject(err)
    }
  })
}

/**
 * @param {string} action
 * @param {object} [payload]
 * @param {{ onProgress?: Function, scope?: typeof globalThis }} [options]
 */
export async function postNativeCam(action, payload, { onProgress, scope = globalThis } = {}) {
  const webview = ensureListener(scope)
  if (!webview) throw new Error('Native CAM transport is not available')
  const hello = await whenNativeHello(scope)
  if (action === 'hello') return hello
  if (action !== 'ping' && Array.isArray(hello.actions) && !hello.actions.includes(action)) {
    const err = new Error(`Native CAM engine does not implement ${action}`)
    err.code = 'NC7_NATIVE_UNSUPPORTED'
    throw err
  }

  const id = ++requestId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress })
    try {
      webview.postMessage({ channel: CAM_CHANNEL, id, action, payload })
    } catch (err) {
      pending.delete(id)
      reject(err)
    }
  })
}

export function rejectNativeCamPending(message) {
  if (pending.size === 0 && helloWaiters.length === 0) return
  rejectPending(new Error(message))
}

import { SILHOUETTE_RASTER_WASM_BASE64 } from './silhouetteRasterWasmBytes.js'

const PAGE = 65536

let exportsCache = null
let unavailable = false

function decodeWasm() {
  const binary = atob(SILHOUETTE_RASTER_WASM_BASE64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function rasterExports() {
  if (unavailable) return null
  if (exportsCache) return exportsCache
  try {
    const module = new WebAssembly.Module(decodeWasm())
    const instance = new WebAssembly.Instance(module)
    if (typeof instance.exports.raster !== 'function' || !instance.exports.memory) {
      throw new Error('silhouette raster wasm is missing exports')
    }
    exportsCache = instance.exports
    return exportsCache
  } catch {
    unavailable = true
    exportsCache = null
    return null
  }
}

function ensureMemory(memory, bytes) {
  const need = Math.ceil(bytes / PAGE)
  const have = memory.buffer.byteLength / PAGE
  if (need > have) memory.grow(need - have)
}

/**
 * Fill `grid` with the projected occupancy of `position`.
 * Returns false when WASM is unavailable so the caller can use the JS loop.
 * The module memory is private to this call. No SharedArrayBuffer.
 *
 * @param {ArrayLike<number>} position
 * @param {ArrayLike<number>|null} index
 * @param {{ point: { x: number, y: number, z: number }, uAxis: { x: number, z: number } }} frame
 * @param {{ uMin: number, vMin: number, uStep: number, vStep: number, uBins: number, vBins: number }} spec
 * @param {Uint8Array} grid
 */
export function tryRasterizeWithWasm(position, index, frame, spec, grid) {
  const api = rasterExports()
  if (!api) return false
  if (!(spec.uStep > 0) || !(spec.vStep > 0)) return false
  if (!(spec.uBins > 0) || !(spec.vBins > 0)) return false

  try {
    const pos = position instanceof Float32Array ? position : new Float32Array(position)
    if (pos.length < 9) return false
    const cells = spec.uBins * spec.vBins
    if (grid.length < cells) return false

    const indexCount = index?.length ?? 0
    const posBytes = pos.length * 4
    const indexBytes = indexCount * 4
    const memory = api.memory
    ensureMemory(memory, posBytes + indexBytes + cells)

    const posPtr = 0
    const indexPtr = posBytes
    const gridPtr = posBytes + indexBytes
    new Float32Array(memory.buffer, posPtr, pos.length).set(pos)
    if (indexCount) {
      new Uint32Array(memory.buffer, indexPtr, indexCount).set(index)
    }

    const code = api.raster(
      posPtr,
      pos.length,
      indexCount ? indexPtr : 0,
      indexCount,
      gridPtr,
      spec.uBins,
      spec.vBins,
      spec.uMin,
      spec.vMin,
      spec.uStep,
      spec.vStep,
      frame.point.x,
      frame.point.y,
      frame.point.z,
      frame.uAxis.x,
      frame.uAxis.z,
    )
    if (code !== 1) return false
    grid.set(new Uint8Array(memory.buffer, gridPtr, cells))
    return true
  } catch {
    return false
  }
}

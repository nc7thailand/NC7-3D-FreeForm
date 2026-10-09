import {
  resolveToolpathDisplayGeometry,
  triangleCount,
  TOOLPATH_PROXY_MAX_TRIANGLES,
} from './meshProxy.js'

/**
 * @param {import('three').BufferGeometry|null} appGeometry
 * @param {boolean} useProxy
 */
export function peekViewportDisplayStats(appGeometry, useProxy) {
  if (!appGeometry) return null
  const sourceTriangles = triangleCount(appGeometry)
  const heap = readHeapMiB()
  if (!useProxy) {
    return {
      viewMode: 'hi',
      sourceTriangles,
      displayTriangles: sourceTriangles,
      cached: true,
      buildMs: 0,
      heapMiB: heap,
    }
  }
  if (sourceTriangles <= TOOLPATH_PROXY_MAX_TRIANGLES) {
    return {
      viewMode: 'lo',
      sourceTriangles,
      displayTriangles: sourceTriangles,
      cached: true,
      underCap: true,
      buildMs: 0,
      heapMiB: heap,
    }
  }
  const cache = appGeometry.userData?.nc7DisplayProxyGeo
  const cachedGeo = cache?.geometry
  return {
    viewMode: 'lo',
    sourceTriangles,
    displayTriangles: cachedGeo ? triangleCount(cachedGeo) : null,
    cached: !!cachedGeo,
    buildMs: null,
    heapMiB: heap,
  }
}

function readHeapMiB() {
  if (typeof performance !== 'undefined' && performance.memory) {
    return Math.round((performance.memory.usedJSHeapSize / (1024 * 1024)) * 10) / 10
  }
  return null
}

/**
 * Swap only the mesh shell geometry — one GPU mesh, no second model.
 *
 * @param {{ mesh?: import('three').Mesh|null, ownedDisplayGeometry?: import('three').BufferGeometry|null }} state
 * @param {import('three').BufferGeometry|null} appGeometry
 * @param {boolean} useProxy
 */
export function assignViewportMeshGeometry(state, appGeometry, useProxy) {
  const t0 = performance.now()
  if (!state?.mesh || !appGeometry) {
    return { changed: false, buildMs: 0, stats: peekViewportDisplayStats(appGeometry, useProxy) }
  }

  const resolved = useProxy
    ? resolveToolpathDisplayGeometry(appGeometry)
    : {
      geometry: appGeometry,
      owned: false,
      cached: true,
      sourceTriangles: triangleCount(appGeometry),
      displayTriangles: triangleCount(appGeometry),
    }

  const nextGeo = resolved.geometry
  const prevGeo = state.mesh.geometry

  if (prevGeo === nextGeo) {
    const stats = { ...peekViewportDisplayStats(appGeometry, useProxy), buildMs: 0 }
    return { changed: false, buildMs: 0, stats }
  }

  if (state.ownedDisplayGeometry && state.ownedDisplayGeometry !== nextGeo) {
    state.ownedDisplayGeometry.dispose()
    state.ownedDisplayGeometry = null
  }

  state.mesh.geometry = nextGeo
  if (resolved.owned) {
    state.ownedDisplayGeometry = nextGeo
  }

  const buildMs = Math.round((performance.now() - t0) * 10) / 10
  const stats = {
    viewMode: useProxy ? 'lo' : 'hi',
    sourceTriangles: resolved.sourceTriangles ?? triangleCount(appGeometry),
    displayTriangles: resolved.displayTriangles ?? triangleCount(nextGeo),
    cached: !!resolved.cached,
    buildMs,
    heapMiB: readHeapMiB(),
    singleMesh: true,
  }
  return { changed: true, buildMs, stats }
}

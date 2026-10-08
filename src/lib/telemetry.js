/**
 * Lightweight client telemetry for memory / import / toolpath diagnostics.
 * Logs to console; accumulates on window.__NC7_TELEMETRY__ for WebView2 host inspection.
 */

const MAX_EVENTS = 200

function store() {
  if (typeof window === 'undefined') return null
  if (!window.__NC7_TELEMETRY__) {
    window.__NC7_TELEMETRY__ = { events: [], startedAt: Date.now() }
  }
  return window.__NC7_TELEMETRY__
}

function heapSnapshot() {
  if (typeof performance !== 'undefined' && performance.memory) {
    return {
      jsHeapUsedMiB: Math.round((performance.memory.usedJSHeapSize / (1024 * 1024)) * 100) / 100,
      jsHeapTotalMiB: Math.round((performance.memory.totalJSHeapSize / (1024 * 1024)) * 100) / 100,
      jsHeapLimitMiB: Math.round((performance.memory.jsHeapSizeLimit / (1024 * 1024)) * 100) / 100,
    }
  }
  return null
}

/**
 * @param {string} kind
 * @param {Record<string, unknown>} [detail]
 */
export function logTelemetry(kind, detail = {}) {
  const entry = {
    kind,
    at: new Date().toISOString(),
    ...detail,
    heap: heapSnapshot(),
  }

  const bucket = store()
  if (bucket) {
    bucket.events.push(entry)
    if (bucket.events.length > MAX_EVENTS) bucket.events.shift()
  }

  if (import.meta.env?.DEV) {
    console.info('[NC7 telemetry]', kind, detail, entry.heap ?? '')
  }

  return entry
}

export function logImportTelemetry({ fileName, fileSizeBytes, kind, triangles, simplified, originalTriangles }) {
  return logTelemetry('import', {
    fileName,
    fileSizeBytes,
    fileSizeMiB: fileSizeBytes != null ? Math.round((fileSizeBytes / (1024 * 1024)) * 100) / 100 : null,
    format: kind,
    triangles,
    simplified: !!simplified,
    originalTriangles: originalTriangles ?? null,
  })
}

export function logToolpathTelemetry({ rotationN, triangles, durationMs, worker }) {
  return logTelemetry('toolpath', { rotationN, triangles, durationMs, worker: !!worker })
}

export function logWebGLContextTelemetry({ viewer, phase }) {
  return logTelemetry('webgl_context', { viewer, phase })
}

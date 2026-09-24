import {
  runGcodePipelineFromPayload,
  runToolpathPipelineFromPayload,
} from '../lib/camPipeline.js'

self.onmessage = async (event) => {
  const { id, action, payload } = event.data ?? {}

  try {
    if (action === 'computeToolpath') {
      const cutJob = await runToolpathPipelineFromPayload(payload, (done, total) => {
        self.postMessage({ id, type: 'progress', done, total })
      })
      self.postMessage({ id, type: 'result', status: 'success', cutJob })
      return
    }

    if (action === 'compileGcode') {
      const result = runGcodePipelineFromPayload(payload)
      self.postMessage({ id, type: 'result', status: 'success', gcodeResult: result })
      return
    }

    throw new Error(`Unknown worker action: ${action}`)
  } catch (err) {
    self.postMessage({
      id,
      type: 'result',
      status: 'error',
      error: err?.message ?? String(err),
    })
  }
}

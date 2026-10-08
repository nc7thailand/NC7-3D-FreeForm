/**
 * Browser-initiated WebGL context loss / restore handling.
 * Callers should stop their animation loop on loss and remount the viewer on restore.
 */

/**
 * @param {import('three').WebGLRenderer|null} renderer
 * @param {{ onLost?: (event: Event) => void, onRestored?: (event: Event) => void }} [handlers]
 * @returns {() => void} detach listeners
 */
export function attachWebGLContextRecovery(renderer, { onLost, onRestored } = {}) {
  const canvas = renderer?.domElement
  if (!canvas) return () => {}

  const handleLost = (event) => {
    event.preventDefault()
    onLost?.(event)
  }

  const handleRestored = (event) => {
    onRestored?.(event)
  }

  canvas.addEventListener('webglcontextlost', handleLost, false)
  canvas.addEventListener('webglcontextrestored', handleRestored, false)

  return () => {
    canvas.removeEventListener('webglcontextlost', handleLost)
    canvas.removeEventListener('webglcontextrestored', handleRestored)
  }
}

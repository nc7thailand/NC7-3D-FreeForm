/**
 * @template {(...args: any[]) => void} T
 * @param {T} fn
 * @param {number} ms
 * @returns {T & { cancel: () => void, flush: () => void }}
 */
export function debounce(fn, ms) {
  let timer = null
  let lastArgs = null

  const debounced = (...args) => {
    lastArgs = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const callArgs = lastArgs
      lastArgs = null
      fn(...callArgs)
    }, ms)
  }

  debounced.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    lastArgs = null
  }

  debounced.flush = () => {
    if (!timer || !lastArgs) return
    clearTimeout(timer)
    timer = null
    const callArgs = lastArgs
    lastArgs = null
    fn(...callArgs)
  }

  return debounced
}

/** Hard cap for .stl and .3mf imports. Larger files crash low-spec browsers. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024

/**
 * @param {string} filename
 * @returns {'stl'|'3mf'|null}
 */
export function meshImportKind(filename) {
  const name = String(filename ?? '').toLowerCase()
  if (name.endsWith('.stl')) return 'stl'
  if (name.endsWith('.3mf')) return '3mf'
  return null
}

/**
 * Reject an import before any parse. Returns a user-facing message, or null
 * when the file is within the 5 MB limit.
 *
 * @param {{ name?: string, size?: number }|null|undefined} file
 * @returns {string|null}
 */
export function importSizeError(file) {
  const size = file?.size
  if (typeof size !== 'number' || size <= MAX_IMPORT_BYTES) return null
  const mb = (size / (1024 * 1024)).toFixed(2)
  const name = file?.name || 'This file'
  return `${name} is ${mb} MB and exceeds the 5 MB limit. It was not loaded, so a low-spec browser stays stable.`
}

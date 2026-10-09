/** Recommended upload size shown in the import tip (not a hard gate). */
export const RECOMMENDED_IMPORT_BYTES = 5 * 1024 * 1024

/** Standard smooth-import ceiling — no extra warning below this. */
export const STANDARD_IMPORT_BYTES = 10 * 1024 * 1024

/** Absolute maximum raw upload — reject above this before parsing. */
export const HARD_IMPORT_MAX_BYTES = 20 * 1024 * 1024

/** Working mesh triangle budget after optional auto-simplify. */
export const TARGET_WORKING_TRIANGLES = 50_000

export const IMPORT_RECOMMENDATION_TEXT =
  'Please note: For optimal performance on lower-spec PCs, we recommend keeping 3D models under 5 MB. High-resolution meshes are not required for foam cutting.'

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
 * @param {number} bytes
 */
export function formatFileSizeMiB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/**
 * @param {{ name?: string, size?: number }|null|undefined} file
 * @returns {'ok'|'large'|'reject'|null}
 */
export function importSizeTier(file) {
  const size = file?.size
  if (typeof size !== 'number') return null
  if (size > HARD_IMPORT_MAX_BYTES) return 'reject'
  if (size > STANDARD_IMPORT_BYTES) return 'large'
  return 'ok'
}

/**
 * Hard reject copy for files over 20 MB.
 *
 * @param {{ name?: string, size?: number }|null|undefined} file
 * @returns {string|null}
 */
export function importHardRejectMessage(file) {
  if (importSizeTier(file) !== 'reject') return null
  const name = file?.name || 'This file'
  return `${name} is ${formatFileSizeMiB(file.size)} and exceeds the 20 MB maximum safe limit. Choose a smaller model or simplify it in your 3D app before uploading.`
}

/**
 * @deprecated Use importHardRejectMessage — kept for loader guard at 20 MB.
 */
export function importSizeError(file) {
  return importHardRejectMessage(file)
}

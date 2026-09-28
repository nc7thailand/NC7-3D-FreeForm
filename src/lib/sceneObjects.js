/** Random part colors — no black or dark gray (design D4). */
export const PART_COLOR_PALETTE = [
  '#3498db',
  '#e74c3c',
  '#2ecc71',
  '#f39c12',
  '#9b59b6',
  '#1abc9c',
  '#e67e22',
  '#27ae60',
  '#16a085',
  '#d35400',
]

export function generateObjectId() {
  return `obj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function pickPartColor(usedColors = []) {
  const used = new Set(usedColors.filter(Boolean))
  const available = PART_COLOR_PALETTE.filter((c) => !used.has(c))
  const pool = available.length ? available : PART_COLOR_PALETTE
  return pool[Math.floor(Math.random() * pool.length)]
}

/**
 * @typedef {object} SceneObject
 * @property {string} id
 * @property {string} name
 * @property {string} type - artwork | helper-base | helper-bar | helper-cylinder
 * @property {string} color - hex
 * @property {import('three').BufferGeometry} geometry
 * @property {string|null} [parentId]
 * @property {boolean} [includeInCut]
 */

/**
 * @param {import('three').BufferGeometry} geometry
 * @param {object} [opts]
 * @returns {SceneObject}
 */
export function createSceneObject(geometry, {
  name = 'part',
  type = 'artwork',
  color = null,
  id = null,
  parentId = null,
  includeInCut = true,
} = {}) {
  return {
    id: id ?? generateObjectId(),
    name,
    type,
    color: color ?? pickPartColor(),
    geometry,
    parentId,
    includeInCut,
  }
}

export function nextPartName(objects, prefix = 'part') {
  const n = objects.filter((o) => o.type === 'artwork' || !o.parentId).length + 1
  return `${prefix}-${String.fromCharCode(96 + Math.min(n, 26))}`
}

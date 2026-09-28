/** Undo/redo snapshots for multi-object scene state (P2). */

const MAX_HISTORY = 40

/**
 * @param {import('./sceneObjects.js').SceneObject[]} sceneObjects
 */
export function snapshotSceneObjects(sceneObjects) {
  return sceneObjects.map((o) => ({
    id: o.id,
    name: o.name,
    type: o.type,
    color: o.color,
    parentId: o.parentId ?? null,
    includeInCut: o.includeInCut !== false,
    geometry: o.geometry?.clone?.() ?? null,
  })).filter((o) => o.geometry)
}

/**
 * @param {object} state
 */
export function createSceneSnapshot(state) {
  return {
    sceneObjects: snapshotSceneObjects(state.sceneObjects ?? []),
    selectedObjectId: state.selectedObjectId ?? null,
    toolpathObjectId: state.toolpathObjectId ?? null,
    placementRevision: state.placementRevision ?? 0,
    splitPlaneOffsetY: state.splitPlaneOffsetY ?? 0,
  }
}

export function createHistoryStack() {
  return { past: [], future: [] }
}

/**
 * @param {{ past: object[], future: object[] }} stack
 * @param {object} snapshot
 */
export function pushHistorySnapshot(stack, snapshot) {
  stack.past.push(snapshot)
  if (stack.past.length > MAX_HISTORY) stack.past.shift()
  stack.future.length = 0
}

/**
 * @param {{ past: object[], future: object[] }} stack
 * @returns {object|null}
 */
export function undoHistory(stack) {
  if (stack.past.length <= 1) return null
  const current = stack.past.pop()
  stack.future.push(current)
  return stack.past[stack.past.length - 1]
}

/**
 * @param {{ past: object[], future: object[] }} stack
 * @returns {object|null}
 */
export function redoHistory(stack) {
  if (!stack.future.length) return null
  const next = stack.future.pop()
  stack.past.push(next)
  return next
}

export function canUndoHistory(stack) {
  return stack.past.length > 1
}

export function canRedoHistory(stack) {
  return stack.future.length > 0
}

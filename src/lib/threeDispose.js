// Shared Three.js teardown helpers.
//
// Ownership rule: app-owned model geometry (AppState `geometry` / workingRef)
// is disposed only by AppState when it is replaced. Viewers pass it in
// `keepGeometries` so scene teardown never frees buffers still in use.

const TEXTURE_KEYS = [
  'map', 'alphaMap', 'aoMap', 'bumpMap', 'displacementMap', 'emissiveMap',
  'envMap', 'lightMap', 'metalnessMap', 'normalMap', 'roughnessMap', 'specularMap',
  'gradientMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap',
  'sheenColorMap', 'sheenRoughnessMap', 'transmissionMap', 'thicknessMap',
]

/** Dispose a material (or material array) and every texture it references. */
export function disposeMaterial(material) {
  if (!material) return
  if (Array.isArray(material)) {
    for (const m of material) disposeMaterial(m)
    return
  }
  for (const key of TEXTURE_KEYS) {
    material[key]?.dispose?.()
  }
  material.dispose?.()
}

/**
 * Dispose every geometry / material under `root`, detach it from its parent
 * and clear its children.
 *
 * @param {import('three').Object3D|null} root
 * @param {{ keepGeometries?: Iterable<import('three').BufferGeometry|null> }} [options]
 */
export function disposeObject3D(root, { keepGeometries = [] } = {}) {
  if (!root) return
  const keep = new Set(keepGeometries)
  root.traverse((obj) => {
    if (obj.geometry && !keep.has(obj.geometry)) obj.geometry.dispose()
    if (obj.material) disposeMaterial(obj.material)
    if (obj.isWebGLRenderTarget) obj.dispose()
  })
  root.parent?.remove(root)
  root.clear?.()
}

/** Dispose all scene contents except the scene itself. */
export function disposeSceneContents(scene, options) {
  if (!scene) return
  for (const child of [...scene.children]) disposeObject3D(child, options)
  if (scene.background?.isTexture) scene.background.dispose()
  if (scene.environment?.isTexture) scene.environment.dispose()
}

/**
 * Release a WebGLRenderer: GPU programs/buffers, the context, and its canvas.
 *
 * @param {import('three').WebGLRenderer|null} renderer
 * @param {{ loseContext?: boolean }} [options]
 */
export function disposeRenderer(renderer, { loseContext = true } = {}) {
  if (!renderer) return
  renderer.renderLists?.dispose?.()
  renderer.dispose()
  if (loseContext) renderer.forceContextLoss?.()
  renderer.domElement?.parentNode?.removeChild(renderer.domElement)
}

/**
 * Line2 / LineGeometry.setPositions() swaps in new instanced buffers but the
 * GL buffers of the old ones are only released by a dispose event. Firing it
 * first frees them; the geometry stays usable and re-uploads on next render.
 */
export function setLinePositions(lineGeometry, positions) {
  lineGeometry.dispose()
  lineGeometry.setPositions(positions)
}

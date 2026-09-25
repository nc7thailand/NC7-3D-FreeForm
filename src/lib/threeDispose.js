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
  // ShaderMaterial / LineMaterial textures live in uniforms.
  if (material.uniforms) {
    for (const u of Object.values(material.uniforms)) {
      if (u?.value?.isTexture) u.value.dispose()
    }
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
  scene.background = null
  scene.environment = null
}

/**
 * Release a WebGLRenderer: GPU programs/buffers, the context, and its canvas.
 *
 * @param {import('three').WebGLRenderer|null} renderer
 * @param {{ loseContext?: boolean }} [options]
 */
export function disposeRenderer(renderer, { loseContext = true } = {}) {
  if (!renderer) return
  renderer.setAnimationLoop?.(null)
  renderer.renderLists?.dispose?.()
  renderer.dispose()
  if (loseContext) renderer.forceContextLoss?.()
  const canvas = renderer.domElement
  canvas?.parentNode?.removeChild(canvas)
  // A zero-size canvas lets the browser drop its backing store right away
  // instead of waiting for GC of the element.
  if (canvas) {
    canvas.width = 1
    canvas.height = 1
  }
}

/**
 * Null every reference held by a viewer's mutable state object (scene,
 * renderer, overlays, sim playback, trail arrays, model geometry) so nothing
 * stays reachable after unmount. Arrays are replaced, never emptied in place,
 * because one may be shared with app data (e.g. a cut job's point list).
 */
export function releaseViewerState(state) {
  if (!state) return
  for (const key of Object.keys(state)) {
    const value = state[key]
    if (Array.isArray(value)) state[key] = []
    else if (value && (typeof value === 'object' || typeof value === 'function')) state[key] = null
  }
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

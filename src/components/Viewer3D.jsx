import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'

/**
 * 3D viewport (Section 3).
 *
 * Mouse behavior (MS 3D Builder style):
 *  - Left-click drag on the object        : Move/translate the selected object
 *  - Left-click empty space               : Deselect
 *  - Right-click drag                     : Rotate viewpoint
 *  - Mouse wheel                          : Zoom
 *  - No left-drag camera rotation (replaced by object manipulation)
 */
export default function Viewer3D({ geometry, resetKey }) {
  const mountRef = useRef(null)
  const toolbarRef = useRef(null)
  const stateRef = useRef({
    scene: null,
    camera: null,
    renderer: null,
    mesh: null,
    controls: null,
    transform: null,
    raycaster: null,
    pointer: null,
    mode: 'translate',
    selectionBox: null,
  })

  // ---- Init scene, controls, gizmo ----
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x15181c)

    const camera = new THREE.PerspectiveCamera(
      45,
      mount.clientWidth / mount.clientHeight,
      0.1,
      100000
    )
    camera.position.set(5, 5, 5)
    camera.lookAt(0, 0, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    mount.appendChild(renderer.domElement)

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.5))
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9)
    dirLight.position.set(5, 10, 7)
    scene.add(dirLight)

    // Grid helper (floor) to visualize the flat cutting plane
    const grid = new THREE.GridHelper(10, 20, 0x3a5a80, 0x2a3a50)
    grid.position.y = 0
    scene.add(grid)

    // --- OrbitControls: right-drag rotate, wheel zoom, LEFT disabled (obj manipulation) ---
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.mouseButtons = {
      LEFT: null,                              // object manipulation instead
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,               // right-click rotates viewpoint
    }
    controls.touches = {
      ONE: THREE.TOUCH.PAN,
      TWO: THREE.TOUCH.DOLLY_PAN,
    }
    controls.update()

    // --- TransformControls (MS 3D Builder style gizmo) ---
    const transform = new TransformControls(camera, renderer.domElement)
    transform.setMode('translate')
    scene.add(transform)
    transform.addEventListener('dragging-changed', (event) => {
      // Disable orbit interaction while dragging the gizmo
      controls.enabled = !event.value
    })

    // --- Raycaster & pointer for object selection ---
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()

    // Selection highlight box (wireframe around selected object)
    const box = new THREE.Box3Helper(new THREE.Box3(), 0xffcc33)
    box.visible = false
    scene.add(box)

    const state = stateRef.current
    state.scene = scene
    state.camera = camera
    state.renderer = renderer
    state.controls = controls
    state.transform = transform
    state.raycaster = raycaster
    state.pointer = pointer
    state.selectionBox = box

    // --- Object selection on left-click ---
    const onMouseDown = (event) => {
      if (event.button !== 0) return // left click only

      // Do not alter selection while dragging gizmo
      if (transform.dragging) return

      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycaster.setFromCamera(pointer, camera)
      const mesh = state.mesh
      if (!mesh) return
      const intersects = raycaster.intersectObject(mesh, false)

      if (intersects.length > 0) {
        // Select the mesh
        transform.attach(mesh)
        updateSelectionBox(mesh)
        state.selected = mesh
      } else {
        // Clicked empty space -> deselect
        transform.detach()
        box.visible = false
        state.selected = null
      }
    }
    renderer.domElement.addEventListener('pointerdown', onMouseDown)

    // Drag directly on object to move it (in translate mode)
    const onObjectDrag = () => {}

    // --- Mode toggling from toolbar / keyboard ---
    const setMode = (mode) => {
      state.mode = mode
      transform.setMode(mode)
      updateToolbar(state.mode)
    }
    state.setMode = setMode

    const onKeyDown = (e) => {
      // Ignore when typing in inputs elsewhere
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return
      if (e.key === 'w' || e.key === 'W') setMode('translate')
      if (e.key === 'e' || e.key === 'E') setMode('rotate')
    }
    window.addEventListener('keydown', onKeyDown)

    // --- Animation loop ---
    const animate = () => {
      requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    // --- Resize ---
    const onResize = () => {
      if (!mount) return
      const w = mount.clientWidth
      const h = mount.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKeyDown)
      renderer.domElement.removeEventListener('pointerdown', onMouseDown)
      controls.dispose()
      transform.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
    }
  }, [])

  // Rebuild mesh when geometry changes
  useEffect(() => {
    const state = stateRef.current
    if (!state || !state.scene) return

    // Detach gizmo & clear selection before removing old mesh
    if (state.transform) state.transform.detach()
    state.selected = null
    if (state.selectionBox) state.selectionBox.visible = state.mesh ? false : false

    if (state.mesh) {
      state.scene.remove(state.mesh)
      state.mesh.geometry.dispose()
      state.mesh.material.dispose()
      state.mesh = null
    }

    if (!geometry) return

    const material = new THREE.MeshStandardMaterial({
      color: 0x7fb2d9,
      side: THREE.DoubleSide,
      flatShading: true,
      metalness: 0.1,
      roughness: 0.6,
    })
    const mesh = new THREE.Mesh(geometry, material)
    state.mesh = mesh
    state.scene.add(mesh)

    // Frame the object with the camera
    geometry.computeBoundingBox()
    const box = geometry.boundingBox
    if (box) {
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z) || 1
      const dist = maxDim * 2.5
      state.camera.position.copy(center).add(new THREE.Vector3(dist * 0.7, dist * 0.6, dist * 0.9))
      state.camera.lookAt(center)
      state.controls.target.copy(center)
      state.controls.update()
    }
  }, [geometry, resetKey])

  // Update the bounding box helper around selected mesh
  const updateSelectionBox = (mesh) => {
    const state = stateRef.current
    if (!state || !state.selectionBox) return
    mesh.geometry.computeBoundingBox()
    const box = mesh.geometry.boundingBox.clone()
    box.applyMatrix4(mesh.matrixWorld)
    state.selectionBox.box.copy(box)
    state.selectionBox.visible = true
  }

  // Update toolbar highlight
  const updateToolbar = (mode) => {
    const toolbar = toolbarRef.current
    if (!toolbar) return
    toolbar.querySelectorAll('button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode)
    })
  }

  // Expose setMode via ref for toolbar buttons
  const setMode = (mode) => {
    const state = stateRef.current
    if (state && state.setMode) state.setMode(mode)
  }

  return (
    <div className="viewport-wrapper">
      <div className="viewport-toolbar" ref={toolbarRef}>
        <button
          data-mode="translate"
          className="active"
          title="Move (W)"
          onClick={() => setMode('translate')}
        >
          Move
        </button>
        <button
          data-mode="rotate"
          title="Rotate (E)"
          onClick={() => setMode('rotate')}
        >
          Rotate
        </button>
        <span className="toolbar-hint">
          L-click select/move · R-click rotate view · Wheel zoom
        </span>
      </div>
      <div className="viewport3d" ref={mountRef} />
    </div>
  )
}

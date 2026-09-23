import React, { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import ViewCube from './ViewCube'
import {
  toRadians,
  cuttingPlane,
  planePointMiddleFromStock,
} from '../lib/toolpath'
import { projectShadowOutline, shadowPlaneFor } from '../lib/shadowProjection'
import { CUT_MODE_LEFT_ONLY, CUT_MODE_LEFT_TO_RIGHT } from '../lib/cutJob'
import { buildOverlayData, OVERLAY_COLORS } from '../lib/cutOverlay'
import {
  createNextDotGroup,
  createSimOverlayGroup,
  disposeSimOverlay,
  nextSimDot,
  syncSimOverlay,
  wireBlinkOpacity,
} from '../lib/simOverlay3d'

/** Rear cutting plane overlay — set false to show middle plane only. */
const SHOW_CUTTING_PLANE = false
/** Shadow plane + collimated ray-cast silhouette (toolpath page). Disabled —
 *  no use at this stage; keep only model, bounding box, and centre wire guide. */
const SHOW_SHADOW_PLANE = false

/**
 * Dashed bounding box drawn in the MODEL's LOCAL space, added as a CHILD of the
 * model group so it rotates with the model. Its dimensions are computed once
 * from the geometry's local bounding box and never recalculated, so the box
 * never expands when the model turns (an AABB would swing its corners out along
 * world axes and grow at non-orthogonal angles).
 *
 * Returns a THREE.LineSegments positioned at the model's local bbox centre with
 * its own local size equal to the bbox size. Because it is parented to
 * `object`, any rotation/translation of `object` carries the box along rigidly.
 */
function createDashedBBox(geometry, color = 0xffcc33) {
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  if (!bb || bb.isEmpty()) {
    // Empty geometry — return a minimal inert box so callers don't null-check.
    return new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color, dashSize: 1.2, gapSize: 0.8 })
    )
  }

  const size = bb.getSize(new THREE.Vector3())
  const center = bb.getCenter(new THREE.Vector3())

  const boxGeo = new THREE.BoxGeometry(size.x, size.y, size.z)
  const edgesGeo = new THREE.EdgesGeometry(boxGeo)
  const mat = new THREE.LineDashedMaterial({
    color,
    dashSize: 1.2,
    gapSize: 0.8,
    linewidth: 1,
  })
  const lines = new THREE.LineSegments(edgesGeo, mat)
  lines.position.copy(center)
  lines.computeLineDistances()

  // Remind callers this object is static: no per-frame update is needed.
  lines.userData.isStaticBBox = true

  // Dispose the BoxGeometry we only used to derive edges.
  boxGeo.dispose()

  return lines
}

/**
 * Park the OBJ_Gizmo pivot (and its opposite mesh offset) on the geometry's
 * CURRENT centre of mass. The centre moves whenever the geometry is mutated in
 * place — settling, baking a pose — so it must be recomputed, never cached.
 * Leaves the pivot's rotation alone; callers decide whether to clear it.
 */
function placePivotAtGeometryCentre(state) {
  const mesh = state?.mesh
  const objGizmo = state?.objGizmo
  if (!mesh || !objGizmo) return
  const geo = mesh.geometry
  if (!geo) return
  geo.computeBoundingBox()
  const com = geo.boundingBox.getCenter(new THREE.Vector3())
  mesh.position.copy(com).negate()
  objGizmo.position.copy(com)
  objGizmo.updateMatrixWorld(true)
}

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
export default forwardRef(function Viewer3D(
  {
    geometry,
    resetKey,
    thetaDeg = 0,
    cutIndex = 0,
    stock,
    cutJob = null,
    profile,
    silhouettePreview,
    cutMode = CUT_MODE_LEFT_TO_RIGHT,
    onMeshTransformChange,
    onSettle,
    onReset,
    onCenter,
    readOnly = false,
    showToolpathOverlay = false,
    showModelBBox = true,
    combinedView = false,
    simActive = false,
    simPlayback = null,
    rotationN = 16,
  },
  ref
) {
  const mountRef = useRef(null)
  const toolbarRef = useRef(null)
  const rotationRef = useRef(null)
  const rotationPanelRef = useRef(null)
  const viewCubeRef = useRef(null)
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
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
    floorGrid: null,
    floorAxes: null,
    cutPlane: null,
    cutPlaneEdges: null,
    middlePlaneGroup: null,
    rotaryAxisLine: null,
    stockBox: null,
    profileLines: null,
    shadowPlane: null,
    shadowPoints: null,
    overlayGroup: null,
    overlaySignature: null,
    overlayMaterials: [],
    simGroup: null,
    simOverlay: null,
    simWireMaterials: [],
    simActive: false,
    simPlayback: null,
    simOverlayCtx: null,
  })

  const simPlaybackRef = useRef(simPlayback)
  simPlaybackRef.current = simPlayback
  const simOverlayCtxRef = useRef({
    geometry,
    stock,
    cutMode,
    cutIndex,
    rotationN,
    thetaDeg,
  })
  simOverlayCtxRef.current = {
    geometry,
    stock,
    cutMode,
    cutIndex,
    rotationN,
    thetaDeg,
  }

  useImperativeHandle(ref, () => ({
    getMeshWorldMatrix() {
      // On read-only pages (toolpath/gcode) the viewer turns the mesh to
      // preview θ. That pose is presentation only — reporting it as a
      // transform would let a caller bake the preview angle into the vertices,
      // which made the model appear to keep rotating on its own.
      if (readOnlyRef.current) return null
      const mesh = stateRef.current?.mesh
      if (!mesh) return null
      mesh.updateMatrixWorld(true)
      return mesh.matrixWorld.clone()
    },
    refreshMeshPivot() {
      placePivotAtGeometryCentre(stateRef.current)
    },
    centerMesh() {
      const state = stateRef.current
      const gizmo = state?.objGizmo
      if (!gizmo) return
      // Bring the centre of mass onto the turntable axis: world X0/Z0, Y left
      // alone. Rotation is deliberately kept so the user's orientation stands.
      gizmo.position.x = 0
      gizmo.position.z = 0
      gizmo.updateMatrixWorld(true)
      if (state.transform) state.transform.attach(gizmo)
    },
    resetMeshTransform() {
      // Read-only pages preview θ by turning the mesh; clearing the pose there
      // would fight the preview effect and make the model drift every save tick.
      if (readOnlyRef.current) return
      const state = stateRef.current
      const gizmo = state?.objGizmo
      if (!gizmo) return
      // Clear the user's pose, then re-park the pivot on the geometry's current
      // centre of mass. The centre is recomputed live rather than read from a
      // cached rest pose — settling or baking moves it, and a stale value used
      // to leave the gizmo stranded on the floor.
      gizmo.rotation.set(0, 0, 0)
      gizmo.scale.set(1, 1, 1)
      placePivotAtGeometryCentre(state)
      if (state.transform) state.transform.detach()
    },
  }))

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
    camera.position.set(10, 5, 0)
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

    // Grid helper (floor plan) to visualize the flat cutting plane
    const grid = new THREE.GridHelper(50, 10, 0x3a5a80, 0x2a3a50)
    grid.position.y = 0
    scene.add(grid)

    // World origin marker (X=red, Y=green, Z=blue)
    const axes = new THREE.AxesHelper(5)
    scene.add(axes)

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

    // Live rotation readout (degrees) while dragging in rotate mode
    const updateRotationReadout = () => {
      const el = rotationRef.current
      const gizmo = stateRef.current.objGizmo
      if (!el || !gizmo) return
      const r = gizmo.rotation
      const rad2deg = 180 / Math.PI
      el.textContent =
        `X ${r.x * rad2deg}°  Y ${r.y * rad2deg}°  Z ${r.z * rad2deg}°`
    }
    transform.addEventListener('change', () => {
      updateRotationReadout()
      onMeshTransformChange?.()
    })
    transform.addEventListener('dragging-changed', (event) => {
      const el = rotationRef.current
      if (el) {
        if (event.value) {
          el.classList.add('visible')
        } else {
          // Keep the final value visible briefly, then hide if not in rotate mode
          if (stateRef.current.mode !== 'rotate') el.classList.remove('visible')
        }
      }
      if (!event.value) {
        onMeshTransformChange?.()
      }
    })

    // --- Raycaster & pointer for object selection ---
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()

    // Selection highlight box — created per-mesh in the geometry effect.
    // BoxHelper follows the attached object automatically via update().
    let selectionBox = null

    const state = stateRef.current
    state.scene = scene
    state.camera = camera
    state.renderer = renderer
    state.controls = controls
    state.transform = transform
    state.raycaster = raycaster
    state.pointer = pointer
    state.selectionBox = null
    state.floorGrid = grid
    state.floorAxes = axes
    state.activeAxis = null

    // --- Object selection on left-click ---
    const onMouseDown = (event) => {
      if (readOnlyRef.current) return
      if (event.button !== 0) return // left click only

      // Do not alter selection while dragging gizmo
      if (transform.dragging) return

      // If the pointer is over a gizmo ring (in rotate mode), capture that
      // axis as the active axis for the +/- 45 degree buttons.
      if (state.mode === 'rotate' && transform.axis && /^[XYZ]$/.test(transform.axis)) {
        state.activeAxis = transform.axis
        if (state.applyGizmoAxis) state.applyGizmoAxis(transform.axis)
        updateActiveAxisUI()
        return
      }

      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycaster.setFromCamera(pointer, camera)
      const gizmo = state.objGizmo
      const mesh = state.mesh
      if (!gizmo || !mesh) return
      const intersects = raycaster.intersectObject(gizmo, true)

      if (intersects.length > 0) {
        transform.attach(gizmo)
        state.selected = gizmo
        if (state.mode === 'rotate' && state.applyGizmoAxis && state.activeAxis) {
          state.applyGizmoAxis(state.activeAxis)
        }
      } else {
        // Clicked empty space -> deselect
        transform.detach()
        state.selected = null
      }
    }
    renderer.domElement.addEventListener('pointerdown', onMouseDown)

    // Drag directly on object to move it (in translate mode)
    const onObjectDrag = () => {}

    // --- Mode toggling from toolbar / keyboard ---
    const applyGizmoAxis = (axis) => {
      // Show only the selected rotation ring so the user knows which axis turns.
      if (!axis) {
        transform.showX = true
        transform.showY = true
        transform.showZ = true
        return
      }
      transform.showX = axis === 'X'
      transform.showY = axis === 'Y'
      transform.showZ = axis === 'Z'
    }
    state.applyGizmoAxis = applyGizmoAxis

    const setMode = (mode) => {
      if (readOnlyRef.current) return
      state.mode = mode
      transform.setMode(mode)
      updateToolbar(state.mode)
      const el = rotationRef.current
      if (el) el.classList.toggle('visible', mode === 'rotate')
      const panel = rotationPanelRef.current
      if (panel) panel.classList.toggle('visible', mode === 'rotate')

      if (mode === 'rotate') {
        const gizmo = state.objGizmo
        if (gizmo) {
          transform.attach(gizmo)
          state.selected = gizmo
        }
        if (!state.activeAxis) state.activeAxis = 'Y'
        applyGizmoAxis(state.activeAxis)
        updateActiveAxisUI()
      } else {
        state.activeAxis = null
        applyGizmoAxis(null)
        updateActiveAxisUI()
      }
    }
    state.setMode = setMode

    // Highlight the active axis chip in the rotation panel
    const updateActiveAxisUI = () => {
      const panel = rotationPanelRef.current
      if (!panel) return
      const active = state.activeAxis
      panel.querySelectorAll('[data-axis]').forEach((chip) => {
        chip.classList.toggle('active', chip.dataset.axis === active)
      })
      panel.classList.toggle('has-axis', !!active)
    }
    state.updateActiveAxisUI = updateActiveAxisUI

    // Rotate the attached mesh around a world axis by `deg` degrees
    const rotateByAxis = (axis, deg) => {
      const gizmo = state.objGizmo
      if (!gizmo) return
      const axisVec = axis === 'X' ? new THREE.Vector3(1, 0, 0)
        : axis === 'Y' ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(0, 0, 1)
      gizmo.rotateOnWorldAxis(axisVec, deg * Math.PI / 180)
      const r = gizmo.rotation
      const rad2deg = 180 / Math.PI
      const el = rotationRef.current
      if (el) el.textContent =
        `X ${r.x * rad2deg}°  Y ${r.y * rad2deg}°  Z ${r.z * rad2deg}°`
    }
    state.rotateByAxis = rotateByAxis

    // Reposition the camera to a named world view, framed on the model
    const frameCamera = (view) => {
      const info = state.frameInfo
      if (!info) return
      const { center, dist } = info
      let offset
      switch (view) {
        // Matches the framing applied when a model is first loaded.
        case 'home':   offset = new THREE.Vector3(dist * 1.2, dist * 0.3, 0); break
        case 'front':  offset = new THREE.Vector3(0, 0, dist); break
        case 'back':   offset = new THREE.Vector3(0, 0, -dist); break
        case 'right':  offset = new THREE.Vector3(dist, 0, 0); break
        case 'left':   offset = new THREE.Vector3(-dist, 0, 0); break
        case 'top':    offset = new THREE.Vector3(0, dist, 0.001); break
        case 'bottom': offset = new THREE.Vector3(0, -dist, 0.001); break
        case 'iso':
        default:       offset = new THREE.Vector3(dist * 0.7, dist * 0.6, dist * 0.9); break
      }
      state.camera.position.copy(center).add(offset)
      state.camera.lookAt(center)
      state.controls.target.copy(center)
      state.controls.update()
    }
    state.frameCamera = frameCamera

    /**
     * Snap to a named view with the damping residue cleared.
     *
     * OrbitControls keeps an internal spherical offset plus a damping delta. A
     * plain frameCamera() sets the position on the camera, but the next damped
     * update() re-derives the position from that internal state and pulls the
     * camera back off the requested view (right radius, stale azimuth). So:
     * flush the residue with damping off, write the target pose last, and only
     * then restore damping.
     */
    const snapCamera = (view) => {
      const controls = state.controls
      if (!controls) return
      const damping = controls.enableDamping
      controls.enableDamping = false

      // Drain any pending spherical delta while damping is off.
      controls.update()

      // Compute the target pose, then let update() consume the (now empty)
      // residue and finally re-assert the pose so nothing can shift it.
      frameCamera(view)
      const pose = {
        position: state.camera.position.clone(),
        target: controls.target.clone(),
      }
      controls.update()
      state.camera.position.copy(pose.position)
      controls.target.copy(pose.target)
      state.camera.lookAt(pose.target)

      controls.enableDamping = damping
    }
    state.snapCamera = snapCamera

    // Orbit the camera around the target by azimuth/polar deltas (radians)
    const orbitCamera = (dAzimuth, dPolar) => {
      const info = state.frameInfo
      if (!info) return
      const target = info.center
      const offset = new THREE.Vector3().subVectors(state.camera.position, target)
      const r = offset.length()
      let azimuth = Math.atan2(offset.x, offset.z)
      let polar = Math.acos(Math.max(-1, Math.min(1, offset.y / r)))
      azimuth += dAzimuth
      polar = Math.max(0.05, Math.min(Math.PI - 0.05, polar + dPolar))
      offset.set(
        r * Math.sin(polar) * Math.sin(azimuth),
        r * Math.cos(polar),
        r * Math.sin(polar) * Math.cos(azimuth)
      )
      state.camera.position.copy(target).add(offset)
      state.camera.lookAt(target)
      state.controls.target.copy(target)
      state.controls.update()
    }
    state.orbitCamera = orbitCamera

    const onKeyDown = (e) => {
      // Ignore when typing in inputs elsewhere
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return
      if (e.key === 'w' || e.key === 'W') setMode('translate')
      if (e.key === 'e' || e.key === 'E') setMode('rotate')
    }
    window.addEventListener('keydown', onKeyDown)

    // --- Animation loop ---
    // `running` guards against a stale loop outliving its cleanup: React
    // StrictMode mounts twice in development, and a loop still rendering into a
    // disposed (context-lost) renderer floods the console with shader errors.
    let running = true
    let animId = 0
    const animate = () => {
      if (!running) return
      animId = requestAnimationFrame(animate)
      controls.update()

      // The bounding box is a static child of the model group and rotates with
      // it; no per-frame recalculation is needed.

      // Sync the Three.js view cube with the main camera
      if (viewCubeRef.current && state.frameInfo) {
        viewCubeRef.current.sync(camera, state.frameInfo.center)
      }

      if (state.simOverlay) {
        const opacity = wireBlinkOpacity()
        state.simOverlay.wireGlowMat.opacity = Math.max(0, opacity)
        state.simOverlay.wireCoreMat.opacity = Math.max(0, opacity * 0.95)
        state.simOverlay.trailMat.opacity = 0.35
      }

      if (state.simActive && state.simOverlay) {
        syncSimOverlay(state.simOverlay, state.simPlayback, state.simOverlayCtx)
      }

      renderer.render(scene, camera)
    }
    animate()

    // --- Resize ---
    // Line2 lays its quads out in screen space, so every LineMaterial must be
    // told the new viewport size or the strokes warp (the "exploded" look on
    // mobile, where the viewport changes orientation often).
    const syncOverlayResolution = (w, h) => {
      const mats = state.overlayMaterials
      if (mats?.length) {
        for (const m of mats) m.resolution.set(w, h)
      }
      const simMats = state.simWireMaterials
      if (simMats?.length) {
        for (const m of simMats) m.resolution.set(w, h)
      }
    }
    state.syncOverlayResolution = syncOverlayResolution

    const onResize = () => {
      if (!mount) return
      const w = mount.clientWidth
      const h = mount.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      syncOverlayResolution(w, h)
    }
    window.addEventListener('resize', onResize)

    // The window listener misses container-only changes (mobile URL-bar
    // collapse, panel layout shifts) — which are exactly the mobile cases where
    // a stale Line2 resolution warps the overlay strokes. Observe the mount too.
    const sizeObserver = new ResizeObserver(onResize)
    sizeObserver.observe(mount)

    return () => {
      running = false
      cancelAnimationFrame(animId)
      sizeObserver.disconnect()
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKeyDown)
      renderer.domElement.removeEventListener('pointerdown', onMouseDown)
      controls.dispose()
      transform.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
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

    // Dispose previous selection box helper (now a child of the mesh).
    if (state.selectionBox) {
      if (state.selectionBox.parent) state.selectionBox.parent.remove(state.selectionBox)
      state.selectionBox.geometry.dispose()
      state.selectionBox.material.dispose()
      state.selectionBox = null
    }

    // Clean up previous OBJ_Gizmo and mesh
    if (state.objGizmo) {
      if (state.transform) state.transform.detach()
      if (state.mesh) state.objGizmo.remove(state.mesh)
      state.scene.remove(state.objGizmo)
      state.objGizmo = null
    }
    if (state.mesh) {
      state.mesh.geometry.dispose()
      state.mesh.material.dispose()
      state.mesh = null
    }

    if (!geometry) return

    // Center once for newly loaded raw geometry (Page 1 edit mode only).
    if (!readOnly && !geometry.userData.nc7CentroidApplied) {
      geometry.computeBoundingBox()
      const centroid = geometry.boundingBox.getCenter(new THREE.Vector3())
      geometry.translate(-centroid.x, -centroid.y, -centroid.z)
      geometry.computeBoundingBox()
      geometry.translate(0, -geometry.boundingBox.min.y, 0)
      geometry.userData.nc7CentroidApplied = true
      geometry.computeBoundingBox()
    }

    // Compute center of mass from geometry bounding box
    geometry.computeBoundingBox()
    const com = geometry.boundingBox.getCenter(new THREE.Vector3())

    const material = new THREE.MeshStandardMaterial({
      color: 0x7fb2d9,
      side: THREE.DoubleSide,
      flatShading: true,
      metalness: 0.1,
      roughness: 0.6,
    })
    const mesh = new THREE.Mesh(geometry, material)
    state.mesh = mesh
    // Position the mesh relative to the OBJ_Gizmo pivot.
    //
    // Read-only (toolpath preview): pivot at world origin (rotary axis). Geometry
    // Y is already in foam-block space (floor Y=0, optional modelOffsetMm lift).
    // Centre X/Z on the axis only — do not subtract min.y or vertical offset is lost.
    //
    // Edit (Model page): the pivot sits at the centre of mass so the move/rotate
    // gizmo is centred on the model; the mesh is offset back so the model stays
    // on the floor.
    const objGizmo = new THREE.Object3D()
    objGizmo.name = 'OBJ_Gizmo'
    if (readOnly) {
      geometry.computeBoundingBox()
      const bb = geometry.boundingBox
      const translateX = -(bb.min.x + bb.max.x) / 2
      const translateZ = -(bb.min.z + bb.max.z) / 2
      objGizmo.position.set(0, 0, 0)
      mesh.position.set(translateX, 0, translateZ)
    } else {
      objGizmo.position.copy(com)
      mesh.position.copy(com).negate()
    }
    objGizmo.add(mesh)
    state.objGizmo = objGizmo
    state.scene.add(objGizmo)

    if (showModelBBox) {
      // Parent the dashed box to the mesh (the model itself) so it rotates
      // rigidly with the model and keeps constant dimensions at every angle.
      // Positioned at the geometry's local bbox centre, computed once.
      const selectionBox = createDashedBBox(geometry, 0xffcc33)
      mesh.add(selectionBox)
      state.selectionBox = selectionBox
    }

    // Attach trans_gizmo to OBJ_Gizmo on Model page (edit mode).
    if (!readOnly && state.transform) {
      state.transform.attach(objGizmo)
      state.selected = objGizmo
      state.transform.setMode(state.mode === 'rotate' ? 'rotate' : 'translate')
      if (state.mode === 'rotate') {
        if (!state.activeAxis) state.activeAxis = 'Y'
        if (state.applyGizmoAxis) state.applyGizmoAxis(state.activeAxis)
        if (state.updateActiveAxisUI) state.updateActiveAxisUI()
      }
    } else if (readOnly && state.transform) {
      state.transform.detach()
      state.selected = null
    }

    // Frame the object with the camera
    const worldBox = new THREE.Box3().setFromObject(objGizmo)
    const center = worldBox.getCenter(new THREE.Vector3())
    const size = worldBox.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z) || 1
    const dist = maxDim * 2.5

    // Remember framing info for the camera view presets
    state.frameInfo = { center: center.clone(), dist }

    // Default camera view = "front" — matches the 2D silhouette's face-on
    // projection (looking along +Z, the same angle the 2D panel draws from).
    state.frameCamera('front')

    // Resize the floor plan / world origin markers to match the model scale
    if (state.floorGrid) {
      state.scene.remove(state.floorGrid)
      state.floorGrid.dispose()
    }
    if (state.floorAxes) {
      state.scene.remove(state.floorAxes)
      state.floorAxes.dispose()
    }

    const floorSize = Math.max(maxDim * 3, 50)
    const divisions = Math.max(Math.floor(floorSize / 100), 2)

    const grid = new THREE.GridHelper(floorSize, divisions, 0x3a5a80, 0x2a3a50)
    grid.position.y = 0
    state.scene.add(grid)
    state.floorGrid = grid

    const axes = new THREE.AxesHelper(maxDim * 0.5)
    state.scene.add(axes)
    state.floorAxes = axes
  }, [geometry, resetKey, readOnly, showModelBBox, showToolpathOverlay])

  useEffect(() => {
    const state = stateRef.current
    if (!state?.scene || !state.objGizmo) return

    if (showModelBBox) {
      if (!state.selectionBox && state.mesh) {
        const selectionBox = createDashedBBox(state.mesh.geometry, 0xffcc33)
        state.mesh.add(selectionBox)
        state.selectionBox = selectionBox
      }
    } else if (state.selectionBox) {
      if (state.selectionBox.parent) state.selectionBox.parent.remove(state.selectionBox)
      state.selectionBox.geometry.dispose()
      state.selectionBox.material.dispose()
      state.selectionBox = null
    }
  }, [showModelBBox, geometry, resetKey])

  // Cutting plane, stock block wireframe, and 3D profile overlay (Page 2 only)
  useEffect(() => {
    const state = stateRef.current
    if (!state?.scene) return

    const disposeObj = (obj) => {
      if (!obj) return
      if (obj.parent) obj.parent.remove(obj)
      else state.scene.remove(obj)
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
        else obj.material.dispose()
      }
    }

    disposeObj(state.cutPlane)
    disposeObj(state.cutPlaneEdges)
    if (state.middlePlaneGroup) {
      state.scene.remove(state.middlePlaneGroup)
      state.middlePlaneGroup.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose()
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
          else obj.material.dispose()
        }
      })
    }
    disposeObj(state.rotaryAxisLine)
    disposeObj(state.stockBox)
    disposeObj(state.profileLines)
    disposeObj(state.shadowPlane)
    disposeObj(state.shadowPoints)
    state.cutPlane = null
    state.cutPlaneEdges = null
    state.middlePlaneGroup = null
    state.rotaryAxisLine = null
    state.stockBox = null
    state.profileLines = null
    state.shadowPlane = null
    state.shadowPoints = null

    if (!showToolpathOverlay) {
      return
    }

    const frameInfo = state.frameInfo
    const extent = frameInfo ? frameInfo.dist * 1.2 : 200
    const planeSize = stock
      ? Math.max(stock.w, stock.h) * 1.08
      : Math.max(extent, 200)

    const planeGeo = new THREE.PlaneGeometry(planeSize, planeSize)

    if (SHOW_CUTTING_PLANE) {
      const planeMat = new THREE.MeshBasicMaterial({
        color: 0xff7722,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
      const planeZ = stock ? -stock.t / 2 : 0
      const cutPlane = new THREE.Mesh(planeGeo, planeMat)
      cutPlane.position.set(0, 0, planeZ)
      cutPlane.rotation.y = toRadians(thetaDeg)
      state.scene.add(cutPlane)
      state.cutPlane = cutPlane

      const edgeGeo = new THREE.EdgesGeometry(planeGeo)
      const edgeMat = new THREE.LineBasicMaterial({ color: 0xff9944, transparent: true, opacity: 0.7 })
      const cutPlaneEdges = new THREE.LineSegments(edgeGeo, edgeMat)
      cutPlaneEdges.position.set(0, 0, planeZ)
      cutPlaneEdges.rotation.y = toRadians(thetaDeg)
      state.scene.add(cutPlaneEdges)
      state.cutPlaneEdges = cutPlaneEdges
    }

    // Middle plane (MP) — the fixed wire-position indicator. In the real
    // machine the wire is fixed in space and the foam (stock) rotates on the
    // turntable, so the cutting plane where the wire sits is FIXED in world
    // space (an X–Y plane, normal +Z). Only the model rotates through it.
    // Its visible width depends on the cut mode:
    //   - left → right: full plane (both sides of the rotation axis)
    //   - left only:    only the u ≤ 0 half (the side being cut)
    const mpGroup = new THREE.Group()
    mpGroup.position.set(0, 0, 0)

    const fullWidth = Math.max(stock?.w ?? extent, stock?.h ?? extent) * 1.08
    const isLeftOnly = cutMode === CUT_MODE_LEFT_ONLY
    const mpWidth = isLeftOnly ? fullWidth / 2 : fullWidth
    const mpHeight = stock?.h ?? extent
    const mpGeo = new THREE.PlaneGeometry(mpWidth, mpHeight)
    const mpMat = new THREE.MeshBasicMaterial({
      color: 0xff3030,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const mpPlane = new THREE.Mesh(mpGeo, mpMat)
    // Center the plane so it spans Y=0 … Y=stock.h (full foam height).
    mpPlane.position.y = mpHeight / 2
    // In left-only mode, shift the half-plane so it covers u ∈ [-full/2, 0].
    if (isLeftOnly) mpPlane.position.x = -fullWidth / 4
    // Combined view draws the cut as an overlay on this plane's coordinate
    // space, and the red sheet competes with it visually, so it is hidden
    // there. The mesh stays in the scene with its transform intact — only its
    // rendering is suppressed, so the overlay placement is unaffected.
    mpPlane.visible = !combinedView
    mpGroup.add(mpPlane)
    state.scene.add(mpGroup)
    state.middlePlaneGroup = mpGroup

    // World Y axis at origin — foam floor (Y=0) up to 2× model height
    let modelHeight = stock?.h ?? extent
    if (geometry) {
      geometry.computeBoundingBox()
      const boxH = geometry.boundingBox.max.y - geometry.boundingBox.min.y
      if (boxH > 1e-6) modelHeight = boxH
    }
    const axisTop = modelHeight * 2
    const axisRadius = Math.max(modelHeight * 0.006, 0.8)
    const axisGeo = new THREE.CylinderGeometry(axisRadius, axisRadius, axisTop, 10)
    const axisMat = new THREE.MeshBasicMaterial({
      color: 0xff3030,
      depthTest: false,
      depthWrite: false,
    })
    const rotaryAxisLine = new THREE.Mesh(axisGeo, axisMat)
    rotaryAxisLine.position.set(0, axisTop / 2, 0)
    rotaryAxisLine.renderOrder = 3
    // Combined view draws the cut on the fixed MP plane, where the red wire
    // marker at the origin competes with the overlay. Hidden, not removed —
    // the mesh keeps its transform so nothing downstream needs to change.
    rotaryAxisLine.visible = !combinedView
    state.scene.add(rotaryAxisLine)
    state.rotaryAxisLine = rotaryAxisLine

    // Foam stock block wireframe (W × H × T). Parented to the rotating group
    // so it turns rigidly with the model; its dimensions are fixed once here.
    if (stock && state.objGizmo) {
      const { w, t, h } = stock
      const boxGeo = new THREE.BoxGeometry(w, h, t)
      const boxMat = new THREE.LineBasicMaterial({ color: 0x6ea8ff, transparent: true, opacity: 0.55 })
      const stockBox = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), boxMat)
      stockBox.position.set(0, h / 2, 0)
      state.objGizmo.add(stockBox)
      state.stockBox = stockBox
      boxGeo.dispose()
    }

    // --- Shadow plane + collimated-light silhouette (edge projection) ---
    if (SHOW_SHADOW_PLANE && geometry) {
      geometry.computeBoundingBox()
      const bb = geometry.boundingBox
      const modelSize = {
        x: bb.max.x - bb.min.x,
        y: bb.max.y - bb.min.y,
        z: bb.max.z - bb.min.z,
      }
      const plane = shadowPlaneFor(geometry, thetaDeg, 160)
      const w = plane.uMax - plane.uMin
      const h = plane.vMax - plane.vMin
      const planeGeo2 = new THREE.PlaneGeometry(w, h)
      const planeMat2 = new THREE.MeshBasicMaterial({
        color: 0x888888,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
      const shadowPlaneMesh = new THREE.Mesh(planeGeo2, planeMat2)
      shadowPlaneMesh.position.set(0, plane.centreY, plane.z)
      state.scene.add(shadowPlaneMesh)
      state.shadowPlane = shadowPlaneMesh

      const t0 = performance.now()
      const result = projectShadowOutline(geometry, plane)
      const elapsedMs = performance.now() - t0
      const outline = result.outline

      let outlineY = null
      let outlineX = null
      if (outline.length >= 2) {
        let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity
        for (let k = 0; k < outline.length; k += 2) {
          const ox = outline[k]
          const oy = outline[k + 1]
          if (ox < minX) minX = ox
          if (ox > maxX) maxX = ox
          if (oy < minY) minY = oy
          if (oy > maxY) maxY = oy
        }
        outlineX = [Math.round(minX), Math.round(maxX)]
        outlineY = [Math.round(minY), Math.round(maxY)]
      }
      // Debug snapshot — read window.__nc7shadow in the console.
      window.__nc7shadow = {
        method: 'edge-projection',
        elapsedMs: Math.round(elapsedMs * 10) / 10,
        modelSize: {
          x: Math.round(modelSize.x),
          y: Math.round(modelSize.y),
          z: Math.round(modelSize.z),
        },
        scanlines: plane.scanlines,
        occupiedRows: result.occupied,
        outlinePts: outline.length / 2,
        outlineX,
        outlineY,
        projectedWidth: Math.round(plane.projectedWidth),
        centreY: Math.round(plane.centreY),
        vMin: Math.round(plane.vMin),
        vMax: Math.round(plane.vMax),
        thetaDeg,
        z: Math.round(plane.z),
      }
      if (outline.length >= 6) {
        const positions = []
        for (let k = 0; k < outline.length; k += 2) {
          positions.push(outline[k], outline[k + 1], plane.z)
        }
        const lineGeo = new THREE.BufferGeometry()
        lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        const lineMat = new THREE.LineBasicMaterial({ color: 0xff0000, depthTest: false })
        const shadowLine = new THREE.LineLoop(lineGeo, lineMat)
        state.scene.add(shadowLine)
        state.shadowPoints = shadowLine
      }
    }

    // Rotate the mesh itself to match the current θ (toolpath page preview).
    if (state.objGizmo) {
      state.objGizmo.rotation.y = toRadians(thetaDeg)
    }

    return () => {
      if (state.middlePlaneGroup) {
        state.scene.remove(state.middlePlaneGroup)
        state.middlePlaneGroup.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose()
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
            else obj.material.dispose()
          }
        })
        state.middlePlaneGroup = null
      }
      disposeObj(state.cutPlane)
      disposeObj(state.cutPlaneEdges)
      disposeObj(state.rotaryAxisLine)
      disposeObj(state.stockBox)
      disposeObj(state.profileLines)
      disposeObj(state.shadowPlane)
      disposeObj(state.shadowPoints)
    }
  }, [thetaDeg, stock, profile, silhouettePreview, cutMode, geometry, resetKey, showToolpathOverlay, combinedView])

  // Combined view: the 2D cut drawing rendered as translucent geometry lying
  // on the FIXED middle plane (the physical wire plane, normal +Z, unrotated).
  //
  // Mapping is the raw MP-local one: u → world X, v → world Y, plane depth → 0.
  // The MP mesh is itself unrotated, so the overlay stays coplanar with it at
  // every θ, and the silhouette shape updates with θ while the plane does not.
  useEffect(() => {
    const state = stateRef.current
    if (!state?.scene) return

    const disposeGroup = () => {
      const g = state.overlayGroup
      if (!g) return
      state.scene.remove(g)
      g.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose()
        if (obj.material) obj.material.dispose()
      })
      state.overlayGroup = null
      state.overlayMaterials = []
    }

    disposeGroup()

    if (!combinedView || !geometry) return

    const data = buildOverlayData({ geometry, thetaDeg, stock, cutMode, cutIndex, cutJob })
    const { contour, cutPath, markers, links, block, cutBoV } = data
    if (!contour.length) return

    const group = new THREE.Group()
    group.name = 'CombinedOverlay'

    // Section (u, v) → world on the fixed MP plane. The MP spans v ∈ [0, h]
    // centred at y = h/2, i.e. v is already measured from the plane's bottom.
    const toWorld = (p) => new THREE.Vector3(p.u, p.v, 0)

    // Overlay elements — the 2D-derived drawing rendered as 3D geometry in
    // Combined view: overlay contour, overlay cut path, overlay link lines and
    // overlay markers. Their visual size is driven by the user's Overlay
    // thickness setting (stock.overlayThickness, 1–10).
    //
    // The overlay contour is deliberately exempt: it is a thin dashed reference
    // outline, and a heavier dash would compete with the overlay cut path it
    // frames. The contour therefore renders at its fixed base weight.
    //
    // The solid overlay lines use Line2 (not THREE.Line). WebGL's core profile
    // clamps gl.lineWidth to 1, so LineBasicMaterial silently ignores
    // `linewidth` — the path and links never thickened, and on some mobile
    // drivers partial wide-line emulation rendered them as scattered stubs.
    // Line2 draws each segment as a screen-space quad, so `linewidth` is real
    // in pixels on every platform. It requires `material.resolution` to match
    // the canvas size or the quads are laid out wrong (same mobile artifact),
    // which the resize handler keeps in sync.
    const overlayScale = Math.min(10, Math.max(1, stock?.overlayThickness ?? 3))

    // Line2 widths are in CSS pixels, so they need a canvas-pixel resolution,
    // not one scaled by devicePixelRatio (the renderer already handles DPR).
    const viewSize = state.renderer
      ? state.renderer.getSize(new THREE.Vector2())
      : new THREE.Vector2(1, 1)

    // Every LineMaterial built here, so the resize handler can re-point their
    // resolution. Cleared with the group in disposeGroup.
    state.overlayMaterials = []

    const addLine = (points, color, { closed = false, opacity = 1, dash = null, width = 1, scale = false } = {}) => {
      if (points.length < 2) return
      const verts = []
      for (const p of points) {
        const w = toWorld(p)
        verts.push(w.x, w.y, w.z)
      }
      if (closed) {
        const w = toWorld(points[0])
        verts.push(w.x, w.y, w.z)
      }

      // Dashed lines stay on THREE.Line: Line2 has no dash support, and the
      // contour is unscaled so it never needed wide lines anyway.
      if (dash) {
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
        const mat = new THREE.LineDashedMaterial({
          color, transparent: true, opacity, depthTest: false, depthWrite: false,
          dashSize: dash[0], gapSize: dash[1], linewidth: width,
        })
        const line = new THREE.Line(geo, mat)
        line.computeLineDistances()
        group.add(line)
        return
      }

      const geo = new LineGeometry()
      geo.setPositions(verts)
      const mat = new LineMaterial({
        color: new THREE.Color(color).getHex(),
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
        linewidth: scale ? width * overlayScale : width,
      })
      mat.resolution.set(viewSize.x, viewSize.y)
      state.overlayMaterials.push(mat)

      const line = new Line2(geo, mat)
      line.computeLineDistances()
      group.add(line)
    }

    const boV = cutBoV ?? 0
    addLine(
      [{ u: 0, v: boV - stock?.h * 2 }, { u: 0, v: boV + stock?.h * 2 }],
      '#ff0000',
      { opacity: 0.55, dash: [2, 2], width: 1 },
    )
    addLine(
      [{ u: -stock?.w * 2, v: boV }, { u: stock?.w * 2, v: boV }],
      '#6ea8ff',
      { opacity: 0.55, dash: [2, 2], width: 1 },
    )

    if (block) {
      const blockPts = [
        { u: block.leftU, v: block.bottomV },
        { u: block.rightU, v: block.bottomV },
        { u: block.rightU, v: block.topV },
        { u: block.leftU, v: block.topV },
      ]
      addLine(blockPts, '#8a9099', { closed: true, opacity: 0.45, dash: [2, 2], width: 1 })
    }

    addLine(contour, '#ffffff', { closed: true, opacity: 0.85, dash: [2.5, 2], width: 1.6 })
    // Overlay cut path — solid blue, scaled.
    addLine(cutPath, OVERLAY_COLORS.cutPath, { opacity: 1, width: 1.5, scale: true })
    // Overlay link lines — green / red, scaled.
    for (const link of links) {
      addLine([link.from, link.to], link.color, { opacity: 0.95, width: 1.25, scale: true })
    }

    // Overlay markers — translucent quads standing on the plane, with a darker
    // border matching the 2D panel's strokeRect. Scaled by the same setting.
    const MARKER_BORDER_SCALE = 1.18
    for (const m of markers) {
      const size = m.size * overlayScale
      const geo = new THREE.PlaneGeometry(size, size)
      const mat = new THREE.MeshBasicMaterial({
        color: m.color,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      })
      const quad = new THREE.Mesh(geo, mat)
      quad.position.set(m.u, m.v, 0)
      quad.renderOrder = 5
      group.add(quad)

      if (m.dark) {
        const borderGeo = new THREE.PlaneGeometry(size * MARKER_BORDER_SCALE, size * MARKER_BORDER_SCALE)
        const borderMat = new THREE.MeshBasicMaterial({
          color: m.dark,
          transparent: true,
          opacity: 1,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
        })
        const border = new THREE.Mesh(borderGeo, borderMat)
        border.position.set(m.u, m.v, 0)
        border.renderOrder = 4
        group.add(border)
      }
    }

    const kPoint = nextSimDot({ geometry, stock, rotationN, cutMode, cutIndex, thetaDeg })
    if (kPoint) {
      const nextDot = createNextDotGroup(overlayScale)
      nextDot.group.position.set(kPoint.u, kPoint.v, 0.02)
      nextDot.group.visible = true
      nextDot.group.renderOrder = 10
      group.add(nextDot.group)
    }

    group.renderOrder = 4
    state.scene.add(group)
    state.overlayGroup = group
    state.overlaySignature = thetaDeg

    return () => disposeGroup()
  }, [combinedView, geometry, thetaDeg, stock, cutMode, cutIndex, cutJob, rotationN])

  // Combined view: dynamic sim overlay (wire marker ⊥ MP plane, trail, next-cut dot).
  useEffect(() => {
    const state = stateRef.current
    if (!state?.scene) return undefined

    state.simActive = simActive && combinedView
    state.simPlayback = simPlayback
    state.simOverlayCtx = simOverlayCtxRef.current

    const disposeSim = () => {
      if (state.simOverlay) {
        disposeSimOverlay(state.simOverlay)
        if (state.simOverlay.group?.parent) {
          state.simOverlay.group.parent.remove(state.simOverlay.group)
        }
        state.simOverlay = null
      }
      state.simGroup = null
      state.simWireMaterials = []
    }

    if (!simActive || !combinedView || !geometry) {
      disposeSim()
      return undefined
    }

    disposeSim()

    const viewSize = state.renderer
      ? state.renderer.getSize(new THREE.Vector2())
      : new THREE.Vector2(1, 1)

    const simOverlay = createSimOverlayGroup({
      geometry,
      stock,
      resolution: viewSize,
    })
    state.simOverlay = simOverlay
    state.simGroup = simOverlay.group
    state.simWireMaterials = simOverlay.simWireMaterials
    state.scene.add(simOverlay.group)

    return () => disposeSim()
  }, [simActive, combinedView, geometry, stock?.overlayThickness, resetKey])

  useEffect(() => {
    const state = stateRef.current
    if (!state) return
    state.simPlayback = simPlayback
    state.simOverlayCtx = simOverlayCtxRef.current
  }, [simPlayback, geometry, stock, cutMode, cutIndex, rotationN, thetaDeg])

  // View-only mode (Page 2): orbit with left-drag, hide gizmo toolbar
  useEffect(() => {
    const state = stateRef.current
    if (!state?.controls || !state?.transform) return
    if (readOnly) {
      state.transform.detach()
      state.transform.enabled = false
      state.selected = null
      state.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE
      state.controls.touches.ONE = THREE.TOUCH.ROTATE
    } else {
      state.transform.enabled = true
      state.controls.mouseButtons.LEFT = null
      state.controls.touches.ONE = THREE.TOUCH.PAN
    }
    state.controls.update()
  }, [readOnly, geometry, resetKey])

  // Combined view (Combined mode only). The MP plane's normal is +Z, so the
  // "front" preset (camera at +Z looking along −Z) shows the scene face-on.
  //
  // The camera is SNAPPED once on entering the mode to give that a stable
  // starting pose, but it is not locked: orbit/zoom/pan stay live so the model
  // can be inspected from any angle. The overlay foreshortens as the view
  // swings away from the plane normal — accepted, it is the user's choice.
  useEffect(() => {
    const state = stateRef.current
    if (!state?.controls || !state?.camera) return

    if (combinedView) {
      if (state.snapCamera) state.snapCamera('front')
    }
  }, [combinedView, geometry, resetKey])

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

  // Select an axis chip in the rotation panel
  const selectAxis = (axis) => {
    const state = stateRef.current
    if (!state) return
    state.activeAxis = axis
    if (state.applyGizmoAxis) state.applyGizmoAxis(axis)
    if (state.updateActiveAxisUI) state.updateActiveAxisUI()
    if (!readOnly && state.mode === 'rotate' && state.objGizmo && state.transform) {
      state.transform.attach(state.objGizmo)
    }
  }

  // Rotate the model around the active axis
  const rotateBy = (deg) => {
    const state = stateRef.current
    if (!state || !state.activeAxis || !state.rotateByAxis) return
    state.rotateByAxis(state.activeAxis, deg)
  }

  // Reposition the camera to a named world view.
  // useCallback keeps this stable: ViewCube rebuilds its WebGL context when its
  // callback props change, so a new function per render would remount it on
  // every frame-affecting state update.
  const setView = useCallback((view) => {
    const state = stateRef.current
    if (state && state.frameCamera) state.frameCamera(view)
  }, [])

  // Orbit the camera 90° in a direction (up/down/left/right)
  const flipView = useCallback((dir) => {
    const state = stateRef.current
    if (!state || !state.orbitCamera) return
    const q = Math.PI / 2
    if (dir === 'up') state.orbitCamera(0, -q)
    else if (dir === 'down') state.orbitCamera(0, q)
    else if (dir === 'left') state.orbitCamera(-q, 0)
    else if (dir === 'right') state.orbitCamera(q, 0)
  }, [])

  const orbitView = useCallback((dAzimuth, dPolar) => {
    const state = stateRef.current
    if (state && state.orbitCamera) state.orbitCamera(dAzimuth, dPolar)
  }, [])

  const goHome = useCallback(() => setView('home'), [setView])

  return (
    <div className={`viewport-wrapper${readOnly ? ' viewport-readonly' : ''}`}>
      {!readOnly && (
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
          <button
            className="toolbar-action danger"
            title="Reset model"
            onClick={() => onReset?.()}
          >
            Reset
          </button>
          <button
            className="toolbar-action"
            title="Settle (F)"
            onClick={() => onSettle?.()}
          >
            Settle
          </button>
          <button
            className="toolbar-action"
            title="Center on turntable (X0, Z0)"
            onClick={() => onCenter?.()}
          >
            Center
          </button>
          <span className="toolbar-hint">
            L-click select/move · R-click rotate view · Wheel zoom
          </span>
        </div>
      )}
      <div className="viewport3d" ref={mountRef} />
      {!readOnly && (
        <>
          <div className="rotation-readout" ref={rotationRef}>X 0°  Y 0°  Z 0°</div>
          <div className="rotation-panel" ref={rotationPanelRef}>
            <div className="rotation-axes">
              <button type="button" data-axis="X" onClick={() => selectAxis('X')}>X</button>
              <button type="button" data-axis="Y" onClick={() => selectAxis('Y')}>Y</button>
              <button type="button" data-axis="Z" onClick={() => selectAxis('Z')}>Z</button>
            </div>
            <div className="rotation-buttons">
              <button type="button" onClick={() => rotateBy(45)}>Up +45°</button>
              <button type="button" onClick={() => rotateBy(-45)}>Down −45°</button>
            </div>
          </div>
        </>
      )}
      <ViewCube
        ref={viewCubeRef}
        hidden={false}
        onSetView={setView}
        onOrbit={orbitView}
        onFlip={flipView}
        onHome={goHome}
      />
    </div>
  )
})

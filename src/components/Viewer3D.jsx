import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import ViewCube from './ViewCube'
import {
  toRadians,
  unprojectFromSection,
  shiftSectionToMiddleAnchor,
  cuttingPlane,
  planePointMiddleFromStock,
} from '../lib/toolpath'
import { wirePathFromProfile } from '../lib/wirePath'

/** Rear cutting plane overlay — set false to show middle plane only. */
const SHOW_CUTTING_PLANE = false

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
    stock,
    profile,
    silhouettePreview,
    onMeshTransformChange,
    onSettle,
    onReset,
    readOnly = false,
    showToolpathOverlay = false,
    showModelBBox = true,
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
    middleProfileLines: null,
  })

  useImperativeHandle(ref, () => ({
    getMeshWorldMatrix() {
      const mesh = stateRef.current?.mesh
      if (!mesh) return null
      mesh.updateMatrixWorld(true)
      return mesh.matrixWorld.clone()
    },
    resetMeshTransform() {
      const state = stateRef.current
      const gizmo = state?.objGizmo
      if (!gizmo) return
      // OBJ_Gizmo is created at the model's centre of mass with the mesh
      // offset by -com, so "origin" for the gizmo is that rest position —
      // not the world origin. Resetting to (0,0,0) would shift the model.
      const rest = state.gizmoRest ?? { x: 0, y: 0, z: 0 }
      gizmo.position.set(rest.x, rest.y, rest.z)
      gizmo.rotation.set(0, 0, 0)
      gizmo.scale.set(1, 1, 1)
      gizmo.updateMatrixWorld(true)
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
    const animate = () => {
      requestAnimationFrame(animate)
      controls.update()

      // Keep the yellow bounding box always bound to the model.
      // BoxHelper.update() recomputes from the attached object's world AABB.
      if (state.selectionBox) {
        state.selectionBox.update()
      }

      // Sync the Three.js view cube with the main camera
      if (viewCubeRef.current && state.frameInfo) {
        viewCubeRef.current.sync(camera, state.frameInfo.center)
      }

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

    // Dispose previous selection box helper
    if (state.selectionBox) {
      state.scene.remove(state.selectionBox)
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
    // Offset mesh so model stays on floor while OBJ_Gizmo is at center of mass
    mesh.position.copy(com).negate()
    state.mesh = mesh

    // Create pivot at center of mass for move/rotate
    const objGizmo = new THREE.Object3D()
    objGizmo.name = 'OBJ_Gizmo'
    objGizmo.position.copy(com)
    // Remember the rest pose: the gizmo lives at the centre of mass, never at
    // the world origin. resetMeshTransform() restores this exact position.
    state.gizmoRest = { x: com.x, y: com.y, z: com.z }
    objGizmo.add(mesh)
    state.objGizmo = objGizmo
    state.scene.add(objGizmo)

    if (showModelBBox) {
      const selectionBox = new THREE.BoxHelper(objGizmo, 0xffcc33)
      state.scene.add(selectionBox)
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
    state.camera.position.copy(center).add(new THREE.Vector3(dist * 1.2, dist * 0.3, 0))
    state.camera.lookAt(center)
    state.controls.target.copy(center)
    state.controls.update()

    // Remember framing info for the camera view presets
    state.frameInfo = { center: center.clone(), dist }

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
      if (!state.selectionBox) {
        const selectionBox = new THREE.BoxHelper(state.objGizmo, 0xffcc33)
        state.scene.add(selectionBox)
        state.selectionBox = selectionBox
      }
    } else if (state.selectionBox) {
      state.scene.remove(state.selectionBox)
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
      state.scene.remove(obj)
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
    disposeObj(state.middleProfileLines)
    state.cutPlane = null
    state.cutPlaneEdges = null
    state.middlePlaneGroup = null
    state.rotaryAxisLine = null
    state.stockBox = null
    state.profileLines = null
    state.middleProfileLines = null

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

    // Middle plane (MP) at block centre — pivots on vertical axis through (0, 0, 0)
    const mpGroup = new THREE.Group()
    mpGroup.position.set(0, 0, 0)
    mpGroup.rotation.y = toRadians(thetaDeg)

    const middleEdgeGeo = new THREE.EdgesGeometry(planeGeo)
    const middleEdgeMat = new THREE.LineBasicMaterial({
      color: 0x8899aa,
      transparent: true,
      opacity: 0.35,
    })
    mpGroup.add(new THREE.LineSegments(middleEdgeGeo, middleEdgeMat))
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
    state.scene.add(rotaryAxisLine)
    state.rotaryAxisLine = rotaryAxisLine

    const addProfilePolyline = (points, frame, targetKey, { loop = false, color = 0xe84040, opacity = 1 } = {}) => {
      if (!points || points.length < 2 || !frame) return
      const positions = []
      for (const p of points) {
        const w = unprojectFromSection(p, frame)
        positions.push(w.x, w.y, w.z)
      }
      const lineGeo = new THREE.BufferGeometry()
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      const lineMat = new THREE.LineBasicMaterial({
        color,
        transparent: opacity < 1,
        opacity,
        linewidth: 2,
        depthTest: false,
        depthWrite: false,
      })
      const lines = loop ? new THREE.LineLoop(lineGeo, lineMat) : new THREE.Line(lineGeo, lineMat)
      lines.renderOrder = loop ? 1 : 2
      state.scene.add(lines)
      state[targetKey] = lines
    }

    // Foam stock block wireframe (W × H × T, axis-aligned)
    if (stock) {
      const { w, t, h } = stock
      const boxGeo = new THREE.BoxGeometry(w, h, t)
      const boxMat = new THREE.LineBasicMaterial({ color: 0x6ea8ff, transparent: true, opacity: 0.55 })
      const stockBox = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), boxMat)
      stockBox.position.set(0, h / 2, 0)
      state.scene.add(stockBox)
      state.stockBox = stockBox
      boxGeo.dispose()
    }

    // Method 1 left wire path (kerf + stock clamp) — open polyline on MP
    if (profile?.polylines?.length && profile.frame && stock) {
      const wirePath = wirePathFromProfile(profile, stock, thetaDeg)
      if (wirePath.length >= 2) {
        const middleFrame = cuttingPlane(thetaDeg, planePointMiddleFromStock())
        const shifted = shiftSectionToMiddleAnchor(wirePath, profile.frame)
        addProfilePolyline(shifted, middleFrame, 'profileLines', { loop: false, color: 0xff9900 })
      }
    }

    // Raw left silhouette — faint reference (before kerf)
    if (profile?.polylines?.length && profile.frame) {
      const middleFrame = cuttingPlane(thetaDeg, planePointMiddleFromStock())
      for (const poly of profile.polylines) {
        const shifted = shiftSectionToMiddleAnchor(poly, profile.frame)
        addProfilePolyline(shifted, middleFrame, 'middleProfileLines', {
          loop: false,
          color: 0x8899aa,
          opacity: 0.35,
        })
        break
      }
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
      disposeObj(state.middleProfileLines)
    }
  }, [thetaDeg, stock, profile, silhouettePreview, geometry, resetKey, showToolpathOverlay])

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

  // Reposition the camera to a named world view
  const setView = (view) => {
    const state = stateRef.current
    if (state && state.frameCamera) state.frameCamera(view)
  }

  // Orbit the camera 90° in a direction (up/down/left/right)
  const flipView = (dir) => {
    const state = stateRef.current
    if (!state || !state.orbitCamera) return
    const q = Math.PI / 2
    if (dir === 'up') state.orbitCamera(0, -q)
    else if (dir === 'down') state.orbitCamera(0, q)
    else if (dir === 'left') state.orbitCamera(-q, 0)
    else if (dir === 'right') state.orbitCamera(q, 0)
  }

  const orbitView = (dAzimuth, dPolar) => {
    const state = stateRef.current
    if (state && state.orbitCamera) state.orbitCamera(dAzimuth, dPolar)
  }

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
        onSetView={setView}
        onOrbit={orbitView}
        onFlip={flipView}
        onHome={() => setView('iso')}
      />
    </div>
  )
})

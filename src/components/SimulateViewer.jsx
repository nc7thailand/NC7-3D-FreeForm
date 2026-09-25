import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import ViewCube from './ViewCube'
import { buildWireStack } from '../lib/simStack'
import { effectivePixelRatio } from '../lib/viewer3dPerformance.js'
import {
  disposeMaterial,
  disposeObject3D,
  disposeRenderer,
  disposeSceneContents,
  releaseViewerState,
} from '../lib/threeDispose.js'

/**
 * Page 4 — stacked red wire paths + optional mesh (DevFoam-style sim view).
 */
export default function SimulateViewer({
  geometry,
  cutJob,
  resetKey,
  wireOnly = false,
  activeCutIndex = 0,
  playbackPoint = null,
}) {
  const mountRef = useRef(null)
  const viewCubeRef = useRef(null)
  const stateRef = useRef({
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    mesh: null,
    stockBox: null,
    wireLines: null,
    activeWire: null,
    playbackMarker: null,
    frameInfo: null,
  })

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x15181c)

    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.1, 100000)
    camera.position.set(5, 5, 5)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.setPixelRatio(effectivePixelRatio())
    mount.appendChild(renderer.domElement)

    scene.add(new THREE.AmbientLight(0xffffff, 0.55))
    const dir = new THREE.DirectionalLight(0xffffff, 0.85)
    dir.position.set(5, 10, 7)
    scene.add(dir)

    const grid = new THREE.GridHelper(50, 10, 0x3a5a80, 0x2a3a50)
    scene.add(grid)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    }

    const playbackMarker = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x44ff66 }),
    )
    playbackMarker.visible = false
    scene.add(playbackMarker)

    const state = stateRef.current
    state.scene = scene
    state.camera = camera
    state.renderer = renderer
    state.controls = controls
    state.floorGrid = grid
    state.playbackMarker = playbackMarker

    const frameCamera = (view) => {
      const info = state.frameInfo
      if (!info) return
      const { center, dist } = info
      let offset
      switch (view) {
        case 'front': offset = new THREE.Vector3(0, 0, dist); break
        case 'back': offset = new THREE.Vector3(0, 0, -dist); break
        case 'right': offset = new THREE.Vector3(dist, 0, 0); break
        case 'left': offset = new THREE.Vector3(-dist, 0, 0); break
        case 'top': offset = new THREE.Vector3(0, dist, 0.001); break
        case 'bottom': offset = new THREE.Vector3(0, -dist, 0.001); break
        default: offset = new THREE.Vector3(dist * 0.7, dist * 0.6, dist * 0.9); break
      }
      camera.position.copy(center).add(offset)
      camera.lookAt(center)
      controls.target.copy(center)
      controls.update()
    }
    state.frameCamera = frameCamera

    const orbitCamera = (dAzimuth, dPolar) => {
      const info = state.frameInfo
      if (!info) return
      const target = info.center
      const offset = new THREE.Vector3().subVectors(camera.position, target)
      const r = offset.length()
      let azimuth = Math.atan2(offset.x, offset.z)
      let polar = Math.acos(Math.max(-1, Math.min(1, offset.y / r)))
      azimuth += dAzimuth
      polar = Math.max(0.05, Math.min(Math.PI - 0.05, polar + dPolar))
      offset.set(
        r * Math.sin(polar) * Math.sin(azimuth),
        r * Math.cos(polar),
        r * Math.sin(polar) * Math.cos(azimuth),
      )
      camera.position.copy(target).add(offset)
      camera.lookAt(target)
      controls.target.copy(target)
      controls.update()
    }
    state.orbitCamera = orbitCamera

    let animId = 0
    let needsContinuousRender = false

    const renderFrame = () => {
      controls.update()
      if (viewCubeRef.current && state.frameInfo) {
        viewCubeRef.current.sync(camera, state.frameInfo.center)
      }
      renderer.render(scene, camera)
    }

    const requestRender = () => {
      if (needsContinuousRender) return
      renderFrame()
    }

    state.requestRender = requestRender

    const animate = () => {
      animId = requestAnimationFrame(animate)
      if (!needsContinuousRender) return
      renderFrame()
    }
    animate()

    const onControlsStart = () => {
      needsContinuousRender = true
    }
    const onControlsEnd = () => {
      needsContinuousRender = false
      renderFrame()
    }
    controls.addEventListener('change', requestRender)
    controls.addEventListener('start', onControlsStart)
    controls.addEventListener('end', onControlsEnd)

    const onResize = () => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      requestRender()
    }
    window.addEventListener('resize', onResize)
    renderFrame()

    return () => {
      cancelAnimationFrame(animId)
      controls.removeEventListener('change', requestRender)
      controls.removeEventListener('start', onControlsStart)
      controls.removeEventListener('end', onControlsEnd)
      window.removeEventListener('resize', onResize)
      controls.dispose()
      const st = stateRef.current
      disposeSceneContents(scene, { keepGeometries: [st?.mesh?.geometry] })
      disposeRenderer(renderer)
      if (st) {
        st.mesh = null
        st.floorGrid = null
        st.stockBox = null
        st.wireLines = null
        st.activeWire = null
      }
    }
  }, [])

  useEffect(() => {
    const state = stateRef.current
    if (!state?.scene) return

    if (state.mesh) {
      // Geometry is owned by AppState.
      state.scene.remove(state.mesh)
      disposeMaterial(state.mesh.material)
    }
    state.mesh = null

    if (!geometry) return

    geometry.computeBoundingBox()

    const mat = new THREE.MeshStandardMaterial({
      color: 0x7fb2d9,
      side: THREE.DoubleSide,
      flatShading: true,
      metalness: 0.1,
      roughness: 0.6,
      transparent: true,
      opacity: 0.85,
    })
    const mesh = new THREE.Mesh(geometry, mat)
    state.mesh = mesh
    state.scene.add(mesh)

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
      state.frameInfo = { center: center.clone(), dist }

      disposeObject3D(state.floorGrid)
      const floorSize = Math.max(maxDim * 3, 50)
      const grid = new THREE.GridHelper(floorSize, Math.max(Math.floor(floorSize / 100), 2), 0x3a5a80, 0x2a3a50)
      state.scene.add(grid)
      state.floorGrid = grid
    }
    state.requestRender?.()
  }, [geometry, resetKey])

  useEffect(() => {
    const state = stateRef.current
    if (!state?.scene) return

    const disposeObj = disposeObject3D

    disposeObj(state.stockBox)
    disposeObj(state.wireLines)
    disposeObj(state.activeWire)
    state.stockBox = null
    state.wireLines = null
    state.activeWire = null

    const stock = cutJob?.stock
    if (stock) {
      const { w, t, h } = stock
      const boxGeo = new THREE.BoxGeometry(w, h, t)
      const boxMat = new THREE.LineBasicMaterial({ color: 0x6ea8ff, transparent: true, opacity: 0.4 })
      const stockBox = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), boxMat)
      stockBox.position.set(0, h / 2, 0)
      state.scene.add(stockBox)
      state.stockBox = stockBox
      boxGeo.dispose()
    }

    const stack = buildWireStack(cutJob, geometry)
    let inactiveSegs = 0
    let activeSegs = 0
    for (const path of stack) {
      const segs = Math.max(0, path.points.length - 1)
      if (path.index === activeCutIndex) activeSegs += segs
      else inactiveSegs += segs
    }
    const inactivePos = new Float32Array(inactiveSegs * 6)
    const activePos = new Float32Array(activeSegs * 6)
    let ia = 0
    let aa = 0

    for (const path of stack) {
      const isActive = path.index === activeCutIndex
      const arr = isActive ? activePos : inactivePos
      let o = isActive ? aa : ia
      for (let i = 0; i < path.points.length - 1; i++) {
        const a = path.points[i]
        const b = path.points[i + 1]
        arr[o++] = a.x; arr[o++] = a.y; arr[o++] = a.z
        arr[o++] = b.x; arr[o++] = b.y; arr[o++] = b.z
      }
      if (isActive) aa = o
      else ia = o
    }

    if (inactivePos.length) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(inactivePos, 3))
      const lines = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ color: 0xe84040, transparent: true, opacity: 0.35 }),
      )
      state.scene.add(lines)
      state.wireLines = lines
    }

    if (activePos.length) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(activePos, 3))
      const lines = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ color: 0xff3333 }),
      )
      state.scene.add(lines)
      state.activeWire = lines
    }
    state.requestRender?.()
  }, [cutJob, geometry, activeCutIndex])

  useEffect(() => {
    const state = stateRef.current
    if (!state?.mesh) return
    state.mesh.visible = !wireOnly
    if (state.stockBox) state.stockBox.visible = !wireOnly
    state.requestRender?.()
  }, [wireOnly])

  useEffect(() => {
    const state = stateRef.current
    const marker = state?.playbackMarker
    if (!marker) return

    if (playbackPoint) {
      marker.position.copy(playbackPoint)
      const scale = state.frameInfo ? state.frameInfo.dist * 0.012 : 2
      marker.scale.setScalar(scale)
      marker.visible = true
    } else {
      marker.visible = false
    }
    state.requestRender?.()
  }, [playbackPoint])

  // Declared last so it runs after every other teardown on unmount.
  useEffect(() => () => releaseViewerState(stateRef.current), [])

  const setView = (view) => stateRef.current?.frameCamera?.(view)
  const orbitView = (dAzimuth, dPolar) => stateRef.current?.orbitCamera?.(dAzimuth, dPolar)
  const flipView = (dir) => {
    const q = Math.PI / 2
    if (dir === 'up') orbitView(0, -q)
    else if (dir === 'down') orbitView(0, q)
    else if (dir === 'left') orbitView(-q, 0)
    else if (dir === 'right') orbitView(q, 0)
  }

  return (
    <div className="viewport-wrapper viewport-readonly simulate-viewport">
      <div className="viewport3d" ref={mountRef} />
      <ViewCube
        ref={viewCubeRef}
        onSetView={setView}
        onOrbit={orbitView}
        onFlip={flipView}
        onHome={() => setView('iso')}
      />
    </div>
  )
}

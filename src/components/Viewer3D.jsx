import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

/**
 * 3D viewport showing the loaded STL geometry (Section 3).
 * Provides orbit controls (rotate / pan / zoom).
 */
export default function Viewer3D({ geometry, resetKey }) {
  const mountRef = useRef(null)
  const stateRef = useRef({ scene: null, camera: null, renderer: null, mesh: null, controls: null })

  // Init scene once
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x15181c)

    const camera = new THREE.PerspectiveCamera(
      45,
      mount.clientWidth / mount.clientHeight,
      0.1,
      10000
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

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.update()

    const state = stateRef.current
    state.scene = scene
    state.camera = camera
    state.renderer = renderer
    state.controls = controls

    const animate = () => {
      requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

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
      renderer.dispose()
      controls.dispose()
      mount.removeChild(renderer.domElement)
    }
  }, [])

  // Rebuild mesh when geometry changes
  useEffect(() => {
    const state = stateRef.current
    const mount = mountRef.current
    if (!state.scene || !mount) return

    // Remove old mesh
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

  return <div className="viewport3d" ref={mountRef} />
}

/**
 * Fit camera to an object (helper).
 */
function fitCameraToObject(camera, controls, object, offset = 1.5) {
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  const fov = camera.fov * (Math.PI / 180)
  let cameraZ = maxDim / (2 * Math.tan(fov / 2))
  cameraZ *= offset
  camera.position.set(center.x, center.y, center.z + cameraZ)
  camera.lookAt(center)
  controls.target.set(center.x, center.y, center.z)
  controls.update()
}

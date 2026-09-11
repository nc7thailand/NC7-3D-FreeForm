import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import * as THREE from 'three'

const FACE_LABELS = ['RIGHT', 'LEFT', 'TOP', 'BOT', 'FRONT', 'BACK']
const FACE_VIEWS = ['right', 'left', 'top', 'bottom', 'front', 'back']
const FACE_COLORS = ['#3373c5', '#2f6fc0', '#5a9be5', '#1f5d9c', '#3a7bd5', '#2b6cb0']

function makeFaceMaterial(label, color) {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  const grad = ctx.createLinearGradient(0, 0, size, size)
  grad.addColorStop(0, color)
  grad.addColorStop(1, shadeColor(color, -20))
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)

  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 3
  ctx.strokeRect(2, 2, size - 4, size - 4)

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 20px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 3
  ctx.fillText(label, size / 2, size / 2)

  const map = new THREE.CanvasTexture(canvas)
  map.needsUpdate = true
  return new THREE.MeshStandardMaterial({
    map,
    roughness: 0.55,
    metalness: 0.08,
  })
}

function shadeColor(hex, amount) {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.max(0, Math.min(255, ((n >> 16) & 0xff) + amount))
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amount))
  const b = Math.max(0, Math.min(255, (n & 0xff) + amount))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

const ViewCube = forwardRef(function ViewCube({ onSetView, onOrbit, onFlip, onHome }, ref) {
  const mountRef = useRef(null)
  const cubeRef = useRef(null)
  const renderRef = useRef(null)
  const dragRef = useRef({ dragging: false, moved: false, x: 0, y: 0 })

  useImperativeHandle(ref, () => ({
    sync(mainCamera, target) {
      const cube = cubeRef.current
      const render = renderRef.current
      if (!cube || !mainCamera || !target) return
      const dir = new THREE.Vector3().subVectors(mainCamera.position, target).normalize()
      cube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir)
      render?.()
    },
  }))

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const pixelSize = mount.clientWidth || 80

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50)
    camera.position.set(2.4, 0.6, 0)
    camera.lookAt(0, 0, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(pixelSize, pixelSize)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    mount.appendChild(renderer.domElement)

    const materials = FACE_LABELS.map((label, i) => makeFaceMaterial(label, FACE_COLORS[i]))
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const cube = new THREE.Mesh(geo, materials)
    scene.add(cube)
    cubeRef.current = cube

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 })
    )
    cube.add(edges)

    scene.add(new THREE.AmbientLight(0xffffff, 0.85))
    const key = new THREE.DirectionalLight(0xffffff, 0.55)
    key.position.set(3, 4, 5)
    scene.add(key)

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()

    const onPointerDown = (e) => {
      dragRef.current = { dragging: true, moved: false, x: e.clientX, y: e.clientY }
      renderer.domElement.setPointerCapture(e.pointerId)
    }

    const onPointerMove = (e) => {
      const d = dragRef.current
      if (!d.dragging) return
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      d.x = e.clientX
      d.y = e.clientY
      if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true
      if (onOrbit) onOrbit(dx * 0.012, dy * 0.012)
    }

    const onPointerUp = (e) => {
      const d = dragRef.current
      if (!d.moved && onSetView) {
        const rect = renderer.domElement.getBoundingClientRect()
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
        raycaster.setFromCamera(pointer, camera)
        const hits = raycaster.intersectObject(cube, false)
        if (hits.length > 0 && hits[0].face) {
          onSetView(FACE_VIEWS[hits[0].face.materialIndex])
        }
      }
      d.dragging = false
      try { renderer.domElement.releasePointerCapture(e.pointerId) } catch (_) {}
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('pointercancel', onPointerUp)

    const render = () => {
      renderer.render(scene, camera)
    }
    renderRef.current = render
    render()

    return () => {
      renderRef.current = null
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointercancel', onPointerUp)
      geo.dispose()
      materials.forEach((m) => { m.map?.dispose(); m.dispose() })
      edges.geometry.dispose()
      edges.material.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      mount.removeChild(renderer.domElement)
      cubeRef.current = null
    }
  }, [onSetView, onOrbit])

  return (
    <div className="view-cube-widget">
      <button type="button" className="vc-home" title="Reset view" onClick={onHome}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M12 3l9 8h-3v9h-4v-6h-4v6H6v-9H3z" />
        </svg>
      </button>
      <button type="button" className="vc-arrow vc-up" title="Flip up" onClick={() => onFlip?.('up')}>▲</button>
      <button type="button" className="vc-arrow vc-down" title="Flip down" onClick={() => onFlip?.('down')}>▼</button>
      <button type="button" className="vc-arrow vc-left" title="Flip left" onClick={() => onFlip?.('left')}>◀</button>
      <button type="button" className="vc-arrow vc-right" title="Flip right" onClick={() => onFlip?.('right')}>▶</button>
      <div className="vc-canvas" ref={mountRef} />
    </div>
  )
})

export default ViewCube

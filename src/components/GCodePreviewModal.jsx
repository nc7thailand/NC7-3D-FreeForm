import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { PREVIEW_VIEW } from '../lib/cutPathStack3d.js'
import { disposeMaterial, disposeRenderer, disposeSceneContents } from '../lib/threeDispose.js'

const COLOR_LEAD_IN = 0x22c55e
const COLOR_CUT = 0x00f3ff
const COLOR_LEAD_OUT = 0xef4444
const COLOR_SIM_DOT_LINK = 0xfacc15
const COLOR_ROTARY_LINK = 0xffffff
const FRAME_DIRECTION = new THREE.Vector3(0.65, 0.45, 0.75).normalize()

const VIEW_OPTIONS = [
  { id: PREVIEW_VIEW.STACK, label: 'Layer stack' },
  { id: PREVIEW_VIEW.ASSEMBLED, label: 'Assembled 3D' },
]

const EMPTY_STACK = { layers: [], pointCount: 0, bounds: null }

function createLineMaterials() {
  const mat = (color, opacity = 0.95) => new THREE.LineBasicMaterial({ color, transparent: true, opacity })
  return {
    leadIn: mat(COLOR_LEAD_IN),
    cut: mat(COLOR_CUT, 0.92),
    leadOut: mat(COLOR_LEAD_OUT),
    simDot: mat(COLOR_SIM_DOT_LINK),
    rotary: mat(COLOR_ROTARY_LINK),
  }
}

function makeLine(points, material) {
  if (!points || points.length < 2) return null
  const verts = new Float32Array(points.length * 3)
  points.forEach((p, i) => {
    verts[i * 3] = p.x
    verts[i * 3 + 1] = p.y
    verts[i * 3 + 2] = p.z
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
  return new THREE.Line(geo, material)
}

/** Dispose line geometries only; the materials are shared and live with the scene. */
function clearLines(group) {
  for (const child of group.children) child.geometry?.dispose()
  group.clear()
}

/**
 * Lightweight mobile-friendly 3D preview — CAM cut blocks
 * (green lead-in → cyan cut → red lead-out), the same chain the G-code emits.
 */
export default function GCodePreviewModal({
  open,
  onClose,
  stack: stackProp = null,
  viewMode = PREVIEW_VIEW.STACK,
  onViewModeChange = null,
  rotaryAxis = 'Z',
  program = null,
  onDownload = null,
}) {
  const mountRef = useRef(null)
  const viewerRef = useRef(null)
  const stack = open && stackProp ? stackProp : EMPTY_STACK

  useEffect(() => {
    if (!open) return undefined
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  useEffect(() => {
    const mount = mountRef.current
    if (!open || !mount) return undefined

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a1a)

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100000)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = false
    controls.screenSpacePanning = true

    scene.add(new THREE.GridHelper(400, 40, 0x444444, 0x222222))
    scene.add(new THREE.AxesHelper(60))

    const linesGroup = new THREE.Group()
    scene.add(linesGroup)
    const materials = createLineMaterials()

    let animId = 0
    let needsContinuousRender = false
    let disposed = false

    // Never call controls.update() here: it emits 'change' → requestRender → recursion.
    const renderFrame = () => {
      if (disposed) return
      renderer.render(scene, camera)
    }

    const requestRender = () => {
      if (needsContinuousRender) return
      renderFrame()
    }

    const animate = () => {
      animId = requestAnimationFrame(animate)
      if (!needsContinuousRender) return
      controls.update()
      renderFrame()
    }
    animate()

    const onControlsStart = () => { needsContinuousRender = true }
    const onControlsEnd = () => {
      needsContinuousRender = false
      renderFrame()
    }
    controls.addEventListener('change', requestRender)
    controls.addEventListener('start', onControlsStart)
    controls.addEventListener('end', onControlsEnd)

    const resize = () => {
      const w = Math.max(mount.clientWidth, 1)
      const h = Math.max(mount.clientHeight, 1)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
      requestRender()
    }

    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(resize)
      : null
    if (ro) ro.observe(mount)
    else window.addEventListener('resize', resize)

    const rebuildLayers = ({ layers, bounds }) => {
      clearLines(linesGroup)

      for (const layer of layers) {
        const parts = [
          makeLine(layer.leadIn, materials.leadIn),
          makeLine(layer.cut, materials.cut),
          makeLine(layer.leadOut, materials.leadOut),
          ...layer.simDotLinks.map((l) => makeLine(l.points, materials.simDot)),
          makeLine(layer.rotaryLink, materials.rotary),
        ]
        for (const line of parts) {
          if (!line) continue
          line.userData.cutIndex = layer.index
          linesGroup.add(line)
        }
      }

      lastBounds = bounds
      frameOrigin()
    }

    // Orbit around the G-code origin (X0 Y0, rotary axis) and back off far
    // enough that every path fits the narrower of the two view angles.
    let lastBounds = null
    const frameOrigin = () => {
      controls.target.set(0, 0, 0)
      let radius = 120
      if (lastBounds) {
        const { min, max } = lastBounds
        for (const x of [min.x, max.x]) {
          for (const y of [min.y, max.y]) {
            for (const z of [min.z, max.z]) {
              radius = Math.max(radius, Math.hypot(x, y, z))
            }
          }
        }
      }
      const vHalf = THREE.MathUtils.degToRad(camera.fov / 2)
      const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect)
      const dist = (radius / Math.sin(Math.min(vHalf, hHalf))) * 1.05
      camera.position.copy(FRAME_DIRECTION).multiplyScalar(dist)
      camera.near = Math.max(dist / 500, 0.1)
      camera.far = Math.max(dist * 20, 5000)
      camera.updateProjectionMatrix()
      controls.update()
      requestRender()
    }

    viewerRef.current = { rebuildLayers }
    const bootId = requestAnimationFrame(() => {
      resize()
      frameOrigin()
    })

    return () => {
      disposed = true
      viewerRef.current = null
      cancelAnimationFrame(bootId)
      cancelAnimationFrame(animId)
      controls.removeEventListener('change', requestRender)
      controls.removeEventListener('start', onControlsStart)
      controls.removeEventListener('end', onControlsEnd)
      if (ro) ro.disconnect()
      else window.removeEventListener('resize', resize)
      clearLines(linesGroup)
      Object.values(materials).forEach(disposeMaterial)
      disposeSceneContents(scene)
      lastBounds = null
      controls.dispose()
      disposeRenderer(renderer)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    viewerRef.current?.rebuildLayers(stack)
  }, [open, stack])

  if (!open) return null

  const layerCount = stack.layers.length
  const hasSimDotLinks = stack.layers.some((l) => l.simDotLinks.length)
  const hasRotaryLinks = stack.layers.some((l) => l.rotaryLink)
  const viewLabel = viewMode === PREVIEW_VIEW.ASSEMBLED
    ? 'rotated to cut angle'
    : `${rotaryAxis} stack → Z`

  return createPortal(
    <div
      className="gcode-preview-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="gcode-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-label="G-code 3D preview"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="gcode-preview-modal-header">
          <div className="gcode-preview-modal-title-row">
            <h2 className="gcode-preview-modal-title">G-code 3D Preview</h2>
            <button
              type="button"
              className="gcode-preview-modal-close"
              onClick={onClose}
              aria-label="Close preview"
            >
              Close
            </button>
          </div>
          <p className="gcode-preview-modal-meta">
            {layerCount > 0
              ? `${stack.pointCount} points · ${layerCount} cut layers · ${viewLabel}`
              : 'No cut paths — commit toolpath on Page 2 first'}
          </p>
          <div className="gcode-preview-modal-toolbar">
            <div className="gcode-preview-modal-toggle" role="group" aria-label="Preview view">
              {VIEW_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={viewMode === opt.id ? 'is-active' : ''}
                  aria-pressed={viewMode === opt.id}
                  onClick={() => { if (opt.id !== viewMode) onViewModeChange?.(opt.id) }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="gcode-preview-modal-download"
              onClick={onDownload}
              disabled={!program || !onDownload}
              title={program ? 'Download G-code file' : 'Compiling G-code…'}
            >
              Download
            </button>
          </div>
        </header>
        <div ref={mountRef} className="gcode-preview-modal-canvas" />
        <p className="gcode-preview-modal-hint">
          <span className="gcode-preview-legend is-lead-in">lead-in</span>
          <span className="gcode-preview-legend is-cut">cut</span>
          <span className="gcode-preview-legend is-lead-out">lead-out</span>
          {hasSimDotLinks && (
            <span className="gcode-preview-legend is-sim-dot">X rapid (G0)</span>
          )}
          {hasRotaryLinks && (
            <span className="gcode-preview-legend is-rotary">{rotaryAxis} rotary</span>
          )}
          · drag to orbit · pinch to zoom
        </p>
      </div>
    </div>,
    document.body,
  )
}

// 3D Combined-view helpers for wire simulation overlay elements.

import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { CUT_MODE_LEFT_ONLY, effectiveCutCount } from './cutJob.js'
import { leftBoEntry } from './indexing/indexSequenceLeftOnly.js'
import { OVERLAY_COLORS, buildOverlayData } from './cutOverlay.js'

export const WIRE_BLINK_PERIOD = 0.45
export const WIRE_GLOW_COLOR = 0xff4500
export const WIRE_CORE_COLOR = 0xfff7ed
export const WIRE_COLLISION_COLOR = 0xff2222
export const TRAIL_COLOR = 0xff4500

/** Blink opacity matching the 2D canvas wire marker. */
export function wireBlinkOpacity(nowSec = Date.now() / 1000) {
  const phase = Math.sin((nowSec / WIRE_BLINK_PERIOD) * Math.PI * 2)
  return 0.5 + 0.45 * phase
}

/** Half-length of the 3D wire marker line (total length = 2× max bbox dimension). */
export function wireMarkerHalfLength(geometry) {
  if (!geometry) return 100
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  if (!bb || bb.isEmpty()) return 100
  const size = bb.getSize(new THREE.Vector3())
  return Math.max(size.x, size.y, size.z, 1)
}

/**
 * Build a vertical wire line through (u, v) on the MP plane, ±halfLen on Z.
 */
export function createWireMarkerLine(u, v, halfLen, lineWidth, resolution) {
  const geo = new LineGeometry()
  geo.setPositions([u, v, -halfLen, u, v, halfLen])
  const mat = new LineMaterial({
    color: WIRE_GLOW_COLOR,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
    linewidth: lineWidth,
  })
  mat.resolution.set(resolution.x, resolution.y)
  const line = new Line2(geo, mat)
  line.computeLineDistances()
  line.renderOrder = 20
  line.userData.isSimWire = true
  return { line, mat, geo }
}

export function createGlowCoreLines(u, v, halfLen, coreWidth, resolution) {
  const geo = new LineGeometry()
  geo.setPositions([u, v, -halfLen, u, v, halfLen])
  const mat = new LineMaterial({
    color: WIRE_CORE_COLOR,
    transparent: true,
    opacity: 1,
    depthTest: false,
    depthWrite: false,
    linewidth: Math.max(1, coreWidth * 0.45),
  })
  mat.resolution.set(resolution.x, resolution.y)
  const line = new Line2(geo, mat)
  line.computeLineDistances()
  line.renderOrder = 21
  line.userData.isSimWireCore = true
  return { line, mat, geo }
}

/**
 * K point (simDot) — start of the next cut, drawn in the current view.
 *
 * Left-only: always the next cut's left entry (BO line, outside block).
 * Left-to-right: odd next cut → left start; even next cut → right start
 * (matches green marker parity in buildOverlayAnnotations).
 */
export function nextSimDot({ geometry, stock, rotationN, cutMode, cutIndex, thetaDeg }) {
  const count = effectiveCutCount(rotationN ?? 0, { mode: cutMode })
  if (!geometry || !count || cutIndex >= count - 1) return null

  const nextCutIndex = cutIndex + 1
  const thetaNext = (nextCutIndex * 360) / count

  if (cutMode === CUT_MODE_LEFT_ONLY) {
    const theta = Number.isFinite(thetaDeg) ? thetaDeg : thetaNext
    return leftBoEntry(geometry, stock, theta)
  }

  const { markers } = buildOverlayData({
    geometry,
    thetaDeg: thetaNext,
    stock,
    cutMode,
    cutIndex: nextCutIndex,
  })
  const green = markers.find((m) => m.color === OVERLAY_COLORS.green)
  if (!green || !Number.isFinite(green.u) || !Number.isFinite(green.v)) return null
  return { u: green.u, v: green.v }
}

export function createNextDotGroup(overlayScale) {
  const size = 9 * 0.35 * overlayScale
  const group = new THREE.Group()
  group.visible = false

  const border = new THREE.Mesh(
    new THREE.PlaneGeometry(size * 1.15, size * 1.15),
    new THREE.MeshBasicMaterial({
      color: 0x1d5cff,
      transparent: true,
      opacity: 1,
      depthTest: false,
      side: THREE.DoubleSide,
    }),
  )
  border.renderOrder = 17
  group.add(border)

  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      side: THREE.DoubleSide,
    }),
  )
  fill.position.z = 0.01
  fill.renderOrder = 18
  group.add(fill)

  return { group, fill, border }
}

function setLinePositions(geo, u, v, halfLen) {
  geo.setPositions([u, v, -halfLen, u, v, halfLen])
}

function setTrailPositions(trailGeo, trailUV) {
  if (!trailUV?.length) {
    trailGeo.setPositions([0, 0, 0.01, 0, 0, 0.01])
    return
  }
  const verts = new Array(trailUV.length * 3)
  for (let i = 0; i < trailUV.length; i++) {
    verts[i * 3] = trailUV[i].u
    verts[i * 3 + 1] = trailUV[i].v
    verts[i * 3 + 2] = 0.01
  }
  trailGeo.setPositions(verts)
}

/**
 * Create the dynamic sim overlay group (wire marker, trail, next-cut dot).
 *
 * @returns {object|null}
 */
export function createSimOverlayGroup({ geometry, stock, resolution }) {
  const overlayScale = Math.min(10, Math.max(1, stock?.overlayThickness ?? 3))
  const lineWidth = 1.5 * overlayScale
  const halfLen = wireMarkerHalfLength(geometry)

  const group = new THREE.Group()
  group.name = 'SimOverlay'
  group.renderOrder = 15

  const trailGeo = new LineGeometry()
  trailGeo.setPositions([0, 0, 0.01, 0, 0, 0.01])
  const trailMat = new LineMaterial({
    color: TRAIL_COLOR,
    transparent: true,
    opacity: 0.35,
    depthTest: false,
    depthWrite: false,
    linewidth: lineWidth,
  })
  trailMat.resolution.set(resolution.x, resolution.y)
  const trail = new Line2(trailGeo, trailMat)
  trail.computeLineDistances()
  trail.renderOrder = 16
  trail.visible = false
  group.add(trail)

  const wireGlow = createWireMarkerLine(0, 0, halfLen, lineWidth, resolution)
  const wireCore = createGlowCoreLines(0, 0, halfLen, lineWidth, resolution)
  wireGlow.line.visible = false
  wireCore.line.visible = false
  group.add(wireGlow.line, wireCore.line)

  const nextDot = createNextDotGroup(overlayScale)
  group.add(nextDot.group)

  return {
    group,
    halfLen,
    lineWidth,
    overlayScale,
    trail,
    trailGeo,
    trailMat,
    wireGlowLine: wireGlow.line,
    wireGlowGeo: wireGlow.geo,
    wireGlowMat: wireGlow.mat,
    wireCoreLine: wireCore.line,
    wireCoreGeo: wireCore.geo,
    wireCoreMat: wireCore.mat,
    nextDotGroup: nextDot.group,
    nextDotFill: nextDot.fill,
    nextDotBorder: nextDot.border,
    simWireMaterials: [wireGlow.mat, wireCore.mat, trailMat],
  }
}

/**
 * Update sim overlay geometry each animation frame.
 */
export function syncSimOverlay(sim, playback, ctx) {
  if (!sim?.group) return

  const wireUV = playback?.wireUV
  const trailUV = playback?.trailUV ?? []
  const colliding = playback?.colliding ?? false
  const { geometry, stock, cutMode, cutIndex, rotationN, thetaDeg } = ctx

  const glowColor = colliding ? WIRE_COLLISION_COLOR : WIRE_GLOW_COLOR
  sim.wireGlowMat.color.setHex(glowColor)

  if (wireUV && Number.isFinite(wireUV.u) && Number.isFinite(wireUV.v)) {
    setLinePositions(sim.wireGlowGeo, wireUV.u, wireUV.v, sim.halfLen)
    setLinePositions(sim.wireCoreGeo, wireUV.u, wireUV.v, sim.halfLen)
    sim.wireGlowLine.computeLineDistances()
    sim.wireCoreLine.computeLineDistances()
    sim.wireGlowLine.visible = true
    sim.wireCoreLine.visible = true
  } else {
    sim.wireGlowLine.visible = false
    sim.wireCoreLine.visible = false
  }

  if (trailUV.length >= 2) {
    setTrailPositions(sim.trailGeo, trailUV)
    sim.trail.computeLineDistances()
    sim.trail.visible = true
  } else {
    sim.trail.visible = false
  }

  // K point is drawn on the static Combined overlay so it is visible without Sim.
  sim.nextDotGroup.visible = false
}

export function disposeSimOverlay(sim) {
  if (!sim?.group) return
  sim.group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose()
    if (obj.material) obj.material.dispose()
  })
}

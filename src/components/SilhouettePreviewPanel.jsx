import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { effectiveCutCount } from '../lib/cutJob'
import WireSimulatorBar from './WireSimulatorBar'
import { useAppState } from '../context/AppState'
import {
  buildFullWirePath,
  buildSimJob,
  cumulativeLengths,
  firstPlayableCut,
  nextPlayableCut,
  pointAtDistance,
  seekGlobal,
} from '../lib/simJob'
import {
  OVERLAY_GRID_BINS,
  OVERLAY_COLORS,
  OVERLAY_LEAD_DASH,
  buildOverlayData,
  buildSafeZoneRegions,
  modelBaseGapRect,
  modelTopGapRect,
  resolveOriginUV,
} from '../lib/cutOverlay'
import { drawFoamBlockDimensions, pickFoamDimensionHit } from '../lib/foamBlockDimensions'
import DirectionMarkerOverlayPanel from './DirectionMarkerOverlayPanel'
import OriginPositionOverlayPanel from './OriginPositionOverlayPanel'
import Minimap2DOverlay from './Minimap2DOverlay'
import {
  bottomMarkerU,
  classifyMarker,
  markerCaption,
  nudgeBoMargin,
  nudgeTopOffset,
  topMarkerV,
} from '../lib/markerStockEdit'
import { measureModelBlockOffset } from '../lib/modelBlockOffset'
import {
  OriginPointManager,
  ORIGIN_FOCUS_BUBBLE,
  originPulseScale,
} from '../lib/originPointManager'
import {
  SafeZoneController,
  SAFE_ZONE,
  SAFE_ZONE_STATE,
  safeZoneBlinkOpacity,
  safeZoneBubbleText,
  safeZoneFieldLabel,
  safeZonePanelTitle,
} from '../lib/safeZoneManager'
import { cutBoV } from '../lib/toolpath'
import { nextSimDot } from '../lib/simOverlay3d'
import { pushSimLog, SIM_LOG_VIEW_ROWS } from '../lib/simLog'
import {
  UI_AXES_DISPLAY,
  displayCoordX,
  displayCoordY,
  displayPointLines,
} from '../lib/uiAxesDisplay'

// Quality is fixed at High (600 grid bins) for the Stage 1 preview.
const GRID_BINS = OVERLAY_GRID_BINS

// Zoom/pan limits for the 2D preview.
const MIN_ZOOM = 0.5
const MAX_ZOOM = 10

// Experimental Sim module — 2D panel only, deliberately not in the shared
// overlay colour set so the Combined view is untouched.
// Next-rotation start point: white fill inside a blue outer stroke with a
// yellow inner stroke. 9px rather than the 7px direction markers — two strokes
// do not read at 7px.
const SIM_DOT_SIZE = 9
const SIM_DOT_FILL = '#ffffff'
const SIM_DOT_OUTER = '#1d5cff'
const SIM_DOT_INNER = '#facc15'
// Cutting-wire marker: translucent glow + bright core, blinking.
const WIRE_GLOW_R = 8
const WIRE_CORE_R = 3.5
const WIRE_GLOW_COLOR = '#ff4500'
const WIRE_CORE_COLOR = '#fff7ed'
const WIRE_BLINK_PERIOD = 0.45
// Sim playback speed comes from the simulator's own feed rate (Model A):
// baseSpeed = simFeedRate / 60 mm/s, scaled by the speed multiplier. Both live
// in `simSettings` (AppState + localStorage), so there is no module constant.
// Data-log sampling interval during playback (10 Hz).
const SIM_SAMPLE_MS = 100
// Trail stroke.
const TRAIL_COLOR = 'rgba(255, 69, 0, 0.35)'
const TRAIL_WIDTH = 1.5
// Matches cutOverlay.js's MARKER_SIZE so the Sim dot is the same size as the
// green/red direction markers.
const MARKER_SIZE = 7
const MARKER_HIT_PAD = 10

const HOVER_KIND = {
  SAFE_TOP: 'safeTop',
  SAFE_BOTTOM: 'safeBottom',
  GREEN: 'greenDot',
  RED: 'redDot',
  SIM: 'simDot',
  ORIGIN: 'origin',
}

function hitTargetContains(t, lx, ly) {
  if (t.hitRect) {
    const r = t.hitRect
    return lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h
  }
  return Math.abs(lx - t.sx) <= t.half && Math.abs(ly - t.sy) <= t.half
}

function buildOriginHoverTarget(originPt, w, h, stock, zoom, pan) {
  if (!originPt) return null
  const { x: ox, y: oy } = uvToScreen(originPt.u, originPt.v, w, h, stock, zoom, pan)
  const baseLen = ORIGIN_GIZMO.LENGTH / 4
  const axisLen = baseLen + baseLen * 0.5
  const pad = 8
  return {
    kind: HOVER_KIND.ORIGIN,
    sx: ox,
    sy: oy,
    hitRect: {
      x: ox - pad,
      y: oy - axisLen - pad,
      w: axisLen + pad * 2 + 18,
      h: axisLen + ORIGIN_GIZMO.LABEL_GAP + 18 + pad,
    },
    detail: {
      title: 'Origin point',
      lines: ['Click to focus · click again to edit'],
    },
  }
}

function overlayStockScale(w, h, stock) {
  const stockExtent = Math.max(stock?.w ?? 1, stock?.t ?? 1, stock?.h ?? 1, 1)
  return (Math.min(w, h) * 0.7) / stockExtent
}

function uvToScreen(u, v, w, h, stock, zoom, pan) {
  const scale = overlayStockScale(w, h, stock) * zoom
  return {
    x: w / 2 + u * scale + pan.x,
    y: h * 0.8 - v * scale + pan.y,
  }
}

function markerHoverDetail(kind, marker, cutIndex) {
  const isGreen = kind === HOVER_KIND.GREEN
  const parity = (cutIndex + 1) % 2 === 1 ? 'odd' : 'even'
  return {
    title: isGreen ? 'Wire start (green)' : 'Wire end (red)',
    lines: [
      `Cut ${cutIndex + 1} · ${parity}`,
      ...displayPointLines(marker.u, marker.v),
    ],
  }
}

function buildCanvasHoverTargets({
  markers,
  simDot,
  originPt,
  cutIndex,
  cutCount,
  w,
  h,
  stock,
  zoom,
  pan,
}) {
  const targets = []
  for (const m of markers) {
    let kind = null
    if (m.color === OVERLAY_COLORS.green) kind = HOVER_KIND.GREEN
    else if (m.color === OVERLAY_COLORS.red) kind = HOVER_KIND.RED
    if (!kind) continue
    const { x, y } = uvToScreen(m.u, m.v, w, h, stock, zoom, pan)
    targets.push({
      kind,
      marker: m,
      sx: x,
      sy: y,
      half: (m.size ?? MARKER_SIZE) / 2 + MARKER_HIT_PAD,
      detail: markerHoverDetail(kind, m, cutIndex),
    })
  }
  if (simDot) {
    const { x, y } = uvToScreen(simDot.u, simDot.v, w, h, stock, zoom, pan)
    const nextCut = Math.min(cutIndex + 2, cutCount)
    targets.push({
      kind: HOVER_KIND.SIM,
      sx: x,
      sy: y,
      half: SIM_DOT_SIZE / 2 + 5,
      detail: {
        title: 'Next cut (K)',
        lines: [
          `Cut ${nextCut} wire entry`,
          ...displayPointLines(simDot.u, simDot.v),
        ],
      },
    })
  }
  const originTarget = buildOriginHoverTarget(originPt, w, h, stock, zoom, pan)
  if (originTarget) targets.push(originTarget)
  return targets
}

const FOCUS_STROKE = {
  color: '#2b6cb0',
  width: 2.5,
  dash: [5, 4],
  pad: 4,
}

function buildCanvasFocusKey(dimHit, hoverHit) {
  if (dimHit) return `dim:${dimHit.axis}`
  if (!hoverHit) return null
  if (hoverHit.marker) {
    return `${hoverHit.kind}:${hoverHit.marker.u.toFixed(3)}:${hoverHit.marker.v.toFixed(3)}`
  }
  return hoverHit.kind
}

function buildCanvasFocusState(dimHit, hoverHit, overlayCtx = null) {
  const key = buildCanvasFocusKey(dimHit, hoverHit)
  if (!key) return null

  if (dimHit) {
    return {
      key,
      kind: 'dim',
      dimHit,
      highlight: { ...dimHit.hitRect },
      bubble: {
        title: dimHit.axis === 'w' ? 'Foam width (W)' : 'Foam height (H)',
        lines: [dimHit.label, 'Tap again to edit'],
        x: dimHit.anchor.x,
        y: dimHit.anchor.y,
      },
    }
  }

  if (hoverHit) {
    let highlight
    if (hoverHit.hitRect) {
      highlight = { ...hoverHit.hitRect }
    } else {
      const half = hoverHit.half ?? MARKER_SIZE / 2 + 4
      highlight = {
        x: hoverHit.sx - half - 2,
        y: hoverHit.sy - half - 2,
        w: (half + 2) * 2,
        h: (half + 2) * 2,
      }
    }
    const lines = [...(hoverHit.detail.lines ?? [])]
    let bubbleTitle = hoverHit.detail.title
    if (hoverHit.kind === HOVER_KIND.ORIGIN) {
      lines.length = 0
      lines.push(ORIGIN_FOCUS_BUBBLE)
    } else if (
      (hoverHit.kind === HOVER_KIND.GREEN || hoverHit.kind === HOVER_KIND.RED)
      && hoverHit.marker
      && overlayCtx
    ) {
      const role = classifyMarker(hoverHit.marker, overlayCtx)
      if (role === 'top') {
        bubbleTitle = 'Wire safe offset (top)'
        lines.length = 0
        lines.push('Distance above foam block top for wire travel.')
      } else if (role) {
        bubbleTitle = 'Wire safe offset (BO margin)'
        lines.length = 0
        lines.push('Horizontal clearance outside the foam block at BO.')
      } else {
        lines.push('Tap again to edit')
      }
    } else if (hoverHit.kind === HOVER_KIND.GREEN || hoverHit.kind === HOVER_KIND.RED) {
      lines.push('Tap again to edit')
    }
    return {
      key,
      kind: hoverHit.kind,
      hoverHit,
      highlight,
      bubble: {
        title: bubbleTitle,
        lines,
        x: hoverHit.sx,
        y: hoverHit.sy,
      },
    }
  }

  return null
}

function drawCanvasFocusStroke(ctx, highlight, blink = false) {
  if (!highlight) return
  const { color, width, dash, pad } = FOCUS_STROKE
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.setLineDash(dash)
  if (blink) ctx.globalAlpha = safeZoneBlinkOpacity()
  ctx.strokeRect(
    highlight.x - pad,
    highlight.y - pad,
    highlight.w + pad * 2,
    highlight.h + pad * 2,
  )
  ctx.restore()
}

function uvRectToScreen(rect, X, Y) {
  const x = X(rect.leftU)
  const y = Y(rect.topV)
  const w = X(rect.rightU) - x
  const h = Y(rect.bottomV) - y
  return { x, y, w, h }
}

function screenRectContains(r, lx, ly) {
  return lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h
}

function pickSafeZoneHit(lx, ly, hits) {
  for (let i = hits.length - 1; i >= 0; i--) {
    if (screenRectContains(hits[i].screenRect, lx, ly)) return hits[i]
  }
  return null
}

function buildSafeZoneFocusState(zoneHit) {
  const zoneType = zoneHit.zoneType
  return {
    key: `safezone:${zoneType}`,
    kind: zoneType === SAFE_ZONE.TOP ? HOVER_KIND.SAFE_TOP : HOVER_KIND.SAFE_BOTTOM,
    zoneHit,
    highlight: { ...zoneHit.screenRect },
    bubble: {
      title: safeZonePanelTitle(zoneType),
      lines: [safeZoneBubbleText(zoneType)],
      x: zoneHit.sx,
      y: zoneHit.sy,
    },
  }
}

function drawSafeZoneFocusFill(ctx, screenRect, zoneType, blink) {
  if (!screenRect) return
  ctx.save()
  ctx.fillStyle = zoneType === SAFE_ZONE.TOP
    ? 'rgba(34, 197, 94, 0.22)'
    : 'rgba(239, 68, 68, 0.22)'
  if (blink) ctx.globalAlpha = safeZoneBlinkOpacity()
  ctx.fillRect(screenRect.x, screenRect.y, screenRect.w, screenRect.h)
  ctx.strokeStyle = zoneType === SAFE_ZONE.TOP ? '#15803d' : '#b91c1c'
  ctx.lineWidth = 2
  ctx.setLineDash([4, 3])
  ctx.strokeRect(screenRect.x, screenRect.y, screenRect.w, screenRect.h)
  ctx.restore()
}

const ORIGIN_GIZMO = {
  X_COLOR: '#e53935',
  Y_COLOR: '#43a047',
  LENGTH: 48,
  SHAFT: 2.5,
  ARROW: 8,
  LABEL_GAP: 4,
}

function drawArrowhead(ctx, tipX, tipY, angle, size, color) {
  const base = size * 0.52
  const bx = tipX - size * Math.cos(angle)
  const by = tipY - size * Math.sin(angle)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(tipX, tipY)
  ctx.lineTo(bx + base * Math.cos(angle + Math.PI / 2), by + base * Math.sin(angle + Math.PI / 2))
  ctx.lineTo(bx + base * Math.cos(angle - Math.PI / 2), by + base * Math.sin(angle - Math.PI / 2))
  ctx.closePath()
  ctx.fill()
}

/** 2D X/Y axis gizmo — red +X right, green +Y up (screen space). */
function drawOriginAxisGizmo(ctx, ox, oy, scale = 1) {
  const { X_COLOR, Y_COLOR, LENGTH, SHAFT, ARROW, LABEL_GAP } = ORIGIN_GIZMO
  const baseLen = LENGTH / 4
  const axisLen = baseLen + baseLen * 0.5
  const arrowLen = Math.min(ARROW, baseLen * 0.35) * 2
  const shaftLen = axisLen - arrowLen
  const xMid = ox + axisLen / 2
  const yMid = oy - axisLen / 2
  const yTip = oy - axisLen
  const xTip = ox + axisLen

  ctx.save()
  if (scale !== 1) {
    ctx.translate(ox, oy)
    ctx.scale(scale, scale)
    ctx.translate(-ox, -oy)
  }
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.18)'
  ctx.shadowBlur = 5
  ctx.shadowOffsetY = 2
  ctx.lineWidth = SHAFT

  ctx.strokeStyle = Y_COLOR
  ctx.beginPath()
  ctx.moveTo(ox, oy)
  ctx.lineTo(ox, oy - shaftLen)
  ctx.stroke()
  drawArrowhead(ctx, ox, yTip, -Math.PI / 2, arrowLen, Y_COLOR)

  ctx.strokeStyle = X_COLOR
  ctx.beginPath()
  ctx.moveTo(ox, oy)
  ctx.lineTo(ox + shaftLen, oy)
  ctx.stroke()
  drawArrowhead(ctx, xTip, oy, 0, arrowLen, X_COLOR)

  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0

  ctx.font = 'bold 12px system-ui, sans-serif'
  ctx.fillStyle = X_COLOR
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('X', xMid, oy + LABEL_GAP)
  ctx.fillStyle = Y_COLOR
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillText('Y', ox - LABEL_GAP, yMid)

  ctx.restore()
}

/**
 * Stage 1 two-dimensional silhouette preview — DevFoam-style, synced to the
 * app's shared rotation state.
 *
 * Renders the raw closed shadow loop for the CURRENT rotation step (thetaDeg)
 * as a dashed black polyline at 50% opacity on a light background. Coordinate
 * system: Y up, origin bottom-left. No block boundary, no frame, no clamp, no
 * safe points.
 * Two dashed reference axes are drawn behind the silhouette: a red vertical
 * line at u = 0 (rotation axis) and a blue horizontal line at v = BO, the
 * bottom cutout offset where the wire stops cutting.
 * A solid blue polyline on top marks the cut path: from the left-hand BO
 * crossing, over the top of the silhouette, to the right-hand BO crossing
 * (left→right mode) or stopping at the top of the u = 0 axis (left-only).
 *
 * The panel is driven by the same thetaDeg as the 3D view (via the shared
 * cutIndex/cutCount in the bottom navigation bar), so stepping rotations keeps
 * both views in lock-step.
 */
export default function SilhouettePreviewPanel({
  geometry,
  cutJob = null,
  thetaDeg,
  cutIndex = 0,
  cutMode,
  stock,
  simActive = false,
  playback = null,
  rotationN,
  onOpenSimPanel,
  onOpenOriginPanel,
}) {
  const useSharedPlayback = !!playback
  const {
    beginBusy,
    endBusy,
    yieldToPaint,
    setBusyProgress,
    advanceSimCut,
    setCutIndexForSimStart,
    simAutoAdvanceRef,
    setSimActive,
    simSettings,
    updateSimSettings,
    commitToolpathSettings,
    applyMarkerStockSettings,
    applyOriginDisplaySettings,
  } = useAppState()

  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const onOpenOriginPanelRef = useRef(onOpenOriginPanel)
  onOpenOriginPanelRef.current = onOpenOriginPanel
  const simJobRef = useRef(null)
  const simJobKeyRef = useRef('')
  const completedLengthRef = useRef(0)
  const simSeekingRef = useRef(false)
  const cutCount = effectiveCutCount(rotationN ?? 0, { mode: cutMode })
  const activeThetaDeg = playback?.displayThetaDeg ?? thetaDeg

  // Zoom/pan transform state. Pan is in screen pixels; zoom is a linear scale.
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef(null) // { startX, startY, x, y, pointerId, panning } — left-drag pan
  const pointerTapEligibleRef = useRef(false)
  const pinchRef = useRef(null) // { startDist, startZoom, lastCx, lastCy }
  const hoverContextRef = useRef({
    markers: [],
    simDot: null,
    cutIndex: 0,
    cutCount: 0,
    stock: null,
  })
  const [hoverBubble, setHoverBubble] = useState(null)
  const dimensionHitsRef = useRef([])
  const safeZoneHitsRef = useRef([])
  const dimensionInputRef = useRef(null)
  const [dimensionEdit, setDimensionEdit] = useState(null)
  const dimensionEditRef = useRef(null)
  dimensionEditRef.current = dimensionEdit
  const [bottomMarkerPanel, setBottomMarkerPanel] = useState(null)
  const [topMarkerPanel, setTopMarkerPanel] = useState(null)
  const [modelGapPanel, setModelGapPanel] = useState(null)
  const [originPositionPanel, setOriginPositionPanel] = useState(null)
  const [originFocused, setOriginFocused] = useState(false)
  const [canvasFocus, setCanvasFocus] = useState(null)
  const canvasFocusRef = useRef(null)
  canvasFocusRef.current = canvasFocus
  const [isCoarsePointer, setIsCoarsePointer] = useState(false)
  const isCoarsePointerRef = useRef(false)
  isCoarsePointerRef.current = isCoarsePointer
  const overlayContextRef = useRef({})
  const stockRef = useRef(stock)
  stockRef.current = stock
  const commitToolpathRef = useRef(commitToolpathSettings)
  commitToolpathRef.current = commitToolpathSettings
  const applyMarkerStockRef = useRef(applyMarkerStockSettings)
  applyMarkerStockRef.current = applyMarkerStockSettings
  const applyOriginDisplayRef = useRef(applyOriginDisplaySettings)
  applyOriginDisplayRef.current = applyOriginDisplaySettings
  const geometryRef = useRef(geometry)
  geometryRef.current = geometry
  const cutModeRef = useRef(cutMode)
  cutModeRef.current = cutMode
  const modelGapControllerRef = useRef(null)
  if (!modelGapControllerRef.current) {
    modelGapControllerRef.current = new SafeZoneController({
      getTopValue: () => measureModelBlockOffset(
        geometryRef.current,
        stockRef.current,
        'top',
      ),
      getBottomValue: () => measureModelBlockOffset(
        geometryRef.current,
        stockRef.current,
        'bottom',
      ),
      onApplyTop: async (n) => {
        await commitToolpathRef.current({
          stock: {
            ...stockRef.current,
            modelOffsetType: 'top',
            modelOffsetMm: n,
          },
          cutMode: cutModeRef.current,
        })
      },
      onApplyBottom: async (n) => {
        await commitToolpathRef.current({
          stock: {
            ...stockRef.current,
            modelOffsetType: 'bottom',
            modelOffsetMm: n,
          },
          cutMode: cutModeRef.current,
        })
      },
    })
  }
  const originManagerRef = useRef(null)
  if (!originManagerRef.current) {
    originManagerRef.current = new OriginPointManager({
      getPosition: () => stockRef.current?.originDisplay ?? 'bottom',
      onApplyPosition: async (display) => {
        await applyOriginDisplayRef.current({
          originDisplay: display,
          originU: undefined,
          originV: undefined,
        })
      },
    })
  }
  const wireSafeControllerRef = useRef(null)
  if (!wireSafeControllerRef.current) {
    wireSafeControllerRef.current = new SafeZoneController({
      getTopValue: () => stockRef.current?.topOffset ?? 20,
      getBottomValue: () => stockRef.current?.boMargin ?? 20,
      onApplyTop: async (n) => {
        await applyMarkerStockRef.current({ topOffset: n })
      },
      onApplyBottom: async (n) => {
        await applyMarkerStockRef.current({ boMargin: n })
      },
    })
  }
  const originDisplayRef = useRef(stock?.originDisplay ?? 'bottom')
  originDisplayRef.current = stock?.originDisplay ?? 'bottom'
  // Sim playback distance along the travel, in mm. Held in a ref (not state)
  // so the animation loop can drive the canvas without re-rendering React on
  // every frame; `simDrawRef` lets the loop call the current draw closure.
  const simDistRef = useRef(0)
  // Playback speed multiplier. Position is integrated (`+= dt × base × speed`),
  // so changing this mid-play alters the rate from that frame forward without
  // moving the marker — an absolute-time model could not do that without a jump.
  // Mirrors `speedMultiplier` from AppState so the animation loop reads it
  // without re-subscribing (and without a new render per slider tick).
  const simSpeedRef = useRef(10)
  const simDrawRef = useRef(() => {})
  const simRafRef = useRef(null)
  // Sim trail (points the marker has passed through) and the 10 Hz data log.
  // The trail is a ref because the draw loop repaints from it every frame; the
  // live label needs React state so the DOM text updates.
  const simTrailRef = useRef([])
  const simLogRef = useRef([])
  const simLastSampleRef = useRef(-Infinity)
  const [simLabel, setSimLabel] = useState(null)
  const [simLogOpen, setSimLogOpen] = useState(false)
  const [simLogTick, setSimLogTick] = useState(0)
  const [simCopied, setSimCopied] = useState(false)
  // Published to the WSB at 10 Hz (see publishDistance). Distinct from
  // simDistRef, which is the per-frame source of truth for the canvas.
  const [simDistance, setSimDistance] = useState(0)
  const [simGlobalDistance, setSimGlobalDistance] = useState(0)
  const [jobTotalLengthMM, setJobTotalLengthMM] = useState(0)
  const [simPlaying, setSimPlaying] = useState(false)
  const speedMultiplier = simSettings?.simSpeedMultiplier ?? 10

  useEffect(() => {
    simSpeedRef.current = speedMultiplier
  }, [speedMultiplier])

  const drawSimLabel = playback?.simLabel ?? simLabel
  const drawTrail = playback?.trailUV ?? simTrailRef.current
  const drawSimDistance = playback?.simDistance ?? simDistance
  const drawJobTotalMM = playback?.jobTotalMM ?? jobTotalLengthMM
  const drawSimGlobalDistance = playback?.simGlobalDistance ?? simGlobalDistance
  const baseSpeedMMPerSec = playback ? (playback.wireFeedRate / 60) : (500 / 60)

  const simJobCacheKey = useMemo(
    () => `${rotationN}|${cutMode}|${stock?.w}|${stock?.t}|${stock?.h}|${cutBoV(stock, geometry)}|${stock?.boMargin}|${geometry?.uuid ?? ''}`,
    [rotationN, cutMode, stock, geometry, stock?.w, stock?.t, stock?.h, stock?.boMargin],
  )

  useEffect(() => {
    if (useSharedPlayback) return
    simJobRef.current = null
    simJobKeyRef.current = ''
    setJobTotalLengthMM(0)
  }, [simJobCacheKey, useSharedPlayback])

  // Precompute job paths in the background when Sim mode opens so the global
  // progress bar has jobTotalLength before the user presses Play.
  useEffect(() => {
    if (useSharedPlayback) return undefined
    if (!simActive || !geometry) return undefined
    if (simJobRef.current && simJobKeyRef.current === simJobCacheKey) return undefined

    let cancelled = false
    ;(async () => {
      try {
        const job = await buildSimJob({ geometry, stock, cutMode, rotationN })
        if (!cancelled) {
          simJobRef.current = job
          simJobKeyRef.current = simJobCacheKey
          setJobTotalLengthMM(job.jobTotalLengthMM)
        }
      } catch (err) {
        console.warn('[sim] background job precompute failed:', err)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [simActive, geometry, stock, cutMode, rotationN, simJobCacheKey])

  const ensureSimJob = useCallback(async () => {
    if (simJobRef.current && simJobKeyRef.current === simJobCacheKey) {
      return simJobRef.current
    }
    beginBusy('Preparing simulation…', { done: 0, total: cutCount })
    await yieldToPaint()
    try {
      const job = await buildSimJob({
        geometry,
        stock,
        cutMode,
        rotationN,
        onProgress: async (done, total) => {
          setBusyProgress(done, total)
          await yieldToPaint()
        },
      })
      simJobRef.current = job
      simJobKeyRef.current = simJobCacheKey
      setJobTotalLengthMM(job.jobTotalLengthMM)
      return job
    } finally {
      await endBusy()
    }
  }, [
    beginBusy,
    cutCount,
    cutMode,
    endBusy,
    geometry,
    rotationN,
    setBusyProgress,
    simJobCacheKey,
    stock,
    yieldToPaint,
  ])

  const setTransform = useCallback((nextZoom, nextPan) => {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom))
    zoomRef.current = z
    panRef.current = nextPan
    setZoom(z)
    setPan(nextPan)
  }, [])

  const resetView = useCallback(() => {
    setTransform(1, { x: 0, y: 0 })
  }, [setTransform])

  const confirmDimensionEdit = useCallback(async (rawValue) => {
    const edit = dimensionEditRef.current
    if (!edit) return
    const n = Math.max(1, Math.round(Number(rawValue)))
    if (!Number.isFinite(n) || n === edit.value) {
      setDimensionEdit(null)
      return
    }
    setDimensionEdit(null)
    await commitToolpathRef.current({
      stock: { ...stockRef.current, [edit.axis]: n },
      cutMode: cutModeRef.current,
    })
  }, [])

  const openBottomMarkerPanel = useCallback((hoverHit, role) => {
    setModelGapPanel(null)
    setOriginPositionPanel(null)
    setTopMarkerPanel(null)
    setBottomMarkerPanel({
      key: `${hoverHit.kind}:${role}:${cutIndex}`,
      kind: hoverHit.kind,
      role,
      placement: 'bottom',
      panelTitle: 'Wire Safe Offset',
      caption: markerCaption(hoverHit.kind),
      fieldLabel: 'Bottom safe offset (BO margin)',
      sx: hoverHit.sx,
      sy: hoverHit.sy,
      draftValue: stock?.boMargin ?? 20,
      appliedValue: stock?.boMargin ?? 20,
      nudgeDownLabel: 'Move left 1 mm',
      nudgeUpLabel: 'Move right 1 mm',
    })
  }, [cutIndex, stock?.boMargin])

  const openTopMarkerPanel = useCallback((hoverHit) => {
    setModelGapPanel(null)
    setOriginPositionPanel(null)
    setBottomMarkerPanel(null)
    setTopMarkerPanel({
      key: `${hoverHit.kind}:top:${cutIndex}`,
      kind: hoverHit.kind,
      role: 'top',
      placement: 'top',
      panelTitle: 'Wire Safe Offset',
      caption: markerCaption(hoverHit.kind),
      fieldLabel: 'Top safe offset',
      sx: hoverHit.sx,
      sy: hoverHit.sy,
      draftValue: stock?.topOffset ?? 20,
      appliedValue: stock?.topOffset ?? 20,
      nudgeDownLabel: 'Move down 1 mm',
      nudgeUpLabel: 'Move up 1 mm',
    })
  }, [cutIndex, stock?.topOffset])

  const openModelGapPanel = useCallback((zoneHit) => {
    setBottomMarkerPanel(null)
    setTopMarkerPanel(null)
    setOriginPositionPanel(null)
    const zoneType = zoneHit.zoneType
    const offsetType = zoneType === SAFE_ZONE.TOP ? 'top' : 'bottom'
    const gapMm = Math.round(measureModelBlockOffset(geometry, stock, offsetType))
    setModelGapPanel({
      key: `modelgap:${zoneType}:${cutIndex}`,
      zoneType,
      offsetType,
      placement: zoneType === SAFE_ZONE.TOP ? 'top' : 'bottom',
      panelTitle: safeZonePanelTitle(zoneType),
      caption: zoneType === SAFE_ZONE.TOP ? 'Model position (top)' : 'Model position (bottom)',
      fieldLabel: safeZoneFieldLabel(zoneType),
      sx: zoneHit.sx,
      sy: zoneHit.sy,
      draftValue: gapMm,
      appliedValue: gapMm,
      nudgeDownLabel: 'Decrease gap 1 mm',
      nudgeUpLabel: 'Increase gap 1 mm',
    })
  }, [cutIndex, geometry, stock])

  const markerPanelOpen = !!(
    bottomMarkerPanel || topMarkerPanel || modelGapPanel || originPositionPanel
  )

  const applySafeZoneFocusUi = useCallback((focusState, manager) => {
    if (manager?.state === SAFE_ZONE_STATE.FOCUSED) {
      setCanvasFocus(focusState)
      wrapRef.current?.classList.add('is-canvas-focused')
      setHoverBubble({
        kind: focusState.kind,
        title: focusState.bubble.title,
        lines: focusState.bubble.lines,
        x: focusState.bubble.x,
        y: focusState.bubble.y,
      })
    } else if (manager?.state === SAFE_ZONE_STATE.EDITING) {
      setCanvasFocus(null)
      setHoverBubble(null)
      wrapRef.current?.classList.remove('is-canvas-focused')
    }
    simDrawRef.current?.()
  }, [])

  const handleSafeZoneInteraction = useCallback(({
    zoneType,
    role,
    anchor,
    hoverHit = null,
    direct = false,
  }) => {
    originManagerRef.current?.reset()
    setOriginFocused(false)
    const focusKey = `safezone:${zoneType}`
    const zoneHit = safeZoneHitsRef.current.find((z) => z.zoneType === zoneType)
      ?? {
        zoneType,
        role,
        sx: anchor.sx,
        sy: anchor.sy,
        screenRect: anchor.screenRect ?? { x: anchor.sx - 8, y: anchor.sy - 8, w: 16, h: 16 },
      }
    const focusState = buildSafeZoneFocusState(zoneHit)

    const openPanel = () => {
      openModelGapPanel(zoneHit)
    }

    const controller = modelGapControllerRef.current
    if (direct) {
      controller.openZoneEditorDirect({
        zoneType,
        focusKey,
        context: { hoverHit, focusState, zoneHit },
        openPanel,
      })
      setCanvasFocus(null)
      setHoverBubble(null)
      wrapRef.current?.classList.remove('is-canvas-focused')
      simDrawRef.current?.()
      return true
    }

    const handled = controller.handleZoneClick({
      zoneType,
      focusKey,
      context: { hoverHit, focusState, zoneHit },
      openPanel,
    })
    if (!handled) return false

    const manager = controller.managerForZone(zoneType)
    applySafeZoneFocusUi(focusState, manager)
    return true
  }, [applySafeZoneFocusUi, openModelGapPanel])

  const handleWireMarkerClick = useCallback((hoverHit, role, { direct = false } = {}) => {
    originManagerRef.current?.reset()
    setOriginFocused(false)
    const focusKey = `wire:${role}:${hoverHit.marker?.u?.toFixed(3)}:${hoverHit.marker?.v?.toFixed(3)}`
    const focusState = buildCanvasFocusState(null, hoverHit, overlayContextRef.current)
    const openPanel = () => {
      if (role === 'top') openTopMarkerPanel(hoverHit)
      else openBottomMarkerPanel(hoverHit, role)
    }

    const controller = wireSafeControllerRef.current
    if (direct) {
      controller.openEditorDirect({ role, focusKey, context: { hoverHit }, openPanel })
      setCanvasFocus(null)
      setHoverBubble(null)
      wrapRef.current?.classList.remove('is-canvas-focused')
      simDrawRef.current?.()
      return true
    }

    const handled = controller.handleMarkerClick({ role, focusKey, context: { hoverHit }, openPanel })
    if (!handled) return false

    const manager = controller.managerForRole(role)
    if (manager?.state === SAFE_ZONE_STATE.FOCUSED && focusState) {
      setCanvasFocus(focusState)
      wrapRef.current?.classList.add('is-canvas-focused')
      setHoverBubble({
        kind: focusState.kind,
        title: focusState.bubble.title,
        lines: focusState.bubble.lines,
        x: focusState.bubble.x,
        y: focusState.bubble.y,
      })
    } else if (manager?.state === SAFE_ZONE_STATE.EDITING) {
      setCanvasFocus(null)
      setHoverBubble(null)
      wrapRef.current?.classList.remove('is-canvas-focused')
    }
    simDrawRef.current?.()
    return true
  }, [openBottomMarkerPanel, openTopMarkerPanel])

  const openOriginPositionPanel = useCallback(() => {
    setBottomMarkerPanel(null)
    setTopMarkerPanel(null)
    setModelGapPanel(null)
    const display = stock?.originDisplay ?? 'bottom'
    setOriginPositionPanel({
      key: `origin:${cutIndex}`,
      draftValue: display,
      appliedValue: display,
    })
  }, [cutIndex, stock?.originDisplay])

  const handleOriginClick = useCallback((hoverHit, { direct = false } = {}) => {
    modelGapControllerRef.current?.resetAll()
    wireSafeControllerRef.current?.resetAll()
    setCanvasFocus(null)

    const openPanel = () => openOriginPositionPanel()
    const manager = originManagerRef.current

    if (direct) {
      manager.openEditorDirect({ openPanel })
      setOriginFocused(false)
      setHoverBubble(null)
      wrapRef.current?.classList.remove('is-canvas-focused')
      simDrawRef.current?.()
      return true
    }

    const result = manager.handleClick({ openPanel })
    if (result === 'focused') {
      setOriginFocused(true)
      wrapRef.current?.classList.add('is-canvas-focused')
      setHoverBubble({
        kind: HOVER_KIND.ORIGIN,
        title: 'Origin point',
        lines: [ORIGIN_FOCUS_BUBBLE],
        x: hoverHit.sx,
        y: hoverHit.sy,
      })
    } else if (result === 'editing') {
      setOriginFocused(false)
      setHoverBubble(null)
      wrapRef.current?.classList.remove('is-canvas-focused')
    }
    simDrawRef.current?.()
    return !!result
  }, [openOriginPositionPanel])

  const updateBottomMarkerDraft = useCallback((rawDraft) => {
    const n = Math.max(0, Math.round(Number(rawDraft)))
    if (!Number.isFinite(n)) return
    setBottomMarkerPanel((prev) => {
      if (!prev) return prev
      const wrap = wrapRef.current
      const ctx = overlayContextRef.current
      if (!wrap || !ctx.block) {
        return { ...prev, draftValue: n }
      }
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      const u = bottomMarkerU(prev.role, ctx.block, n)
      const { x, y } = uvToScreen(u, ctx.boV, w, h, stock, zoomRef.current, panRef.current)
      return { ...prev, draftValue: n, sx: x, sy: y }
    })
  }, [stock])

  const updateTopMarkerDraft = useCallback((rawDraft) => {
    const n = Math.max(0, Math.round(Number(rawDraft)))
    if (!Number.isFinite(n)) return
    setTopMarkerPanel((prev) => {
      if (!prev) return prev
      const wrap = wrapRef.current
      if (!wrap) return { ...prev, draftValue: n }
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      const v = topMarkerV(stock, n)
      const { x, y } = uvToScreen(0, v, w, h, stock, zoomRef.current, panRef.current)
      return { ...prev, draftValue: n, sx: x, sy: y }
    })
  }, [stock])

  const applyBottomMarkerPanel = useCallback(async (boMargin) => {
    const n = Math.max(0, Math.round(Number(boMargin)))
    const unchanged = bottomMarkerPanel?.appliedValue === n
    setBottomMarkerPanel(null)
    setHoverBubble(null)
    if (unchanged) {
      wireSafeControllerRef.current.bottom.cancelEdit()
      wrapRef.current?.classList.remove('is-canvas-focused')
      return
    }
    await wireSafeControllerRef.current.bottom.applyNewValue(boMargin)
  }, [bottomMarkerPanel?.appliedValue])

  const nudgeBottomMarkerDraft = useCallback((dir) => {
    setBottomMarkerPanel((prev) => {
      if (!prev) return prev
      const n = Math.abs(dir) === 1
        ? nudgeBoMargin(prev.role, prev.draftValue ?? 20, dir)
        : Math.max(0, Math.round((prev.draftValue ?? 20) + dir))
      const wrap = wrapRef.current
      const ctx = overlayContextRef.current
      if (!wrap || !ctx.block) return { ...prev, draftValue: n }
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      const u = bottomMarkerU(prev.role, ctx.block, n)
      const { x, y } = uvToScreen(u, ctx.boV, w, h, stock, zoomRef.current, panRef.current)
      return { ...prev, draftValue: n, sx: x, sy: y }
    })
  }, [stock])

  const nudgeTopMarkerDraft = useCallback((dir) => {
    setTopMarkerPanel((prev) => {
      if (!prev) return prev
      const n = Math.abs(dir) === 1
        ? nudgeTopOffset(prev.draftValue ?? 20, dir)
        : Math.max(0, Math.round((prev.draftValue ?? 20) + dir))
      const wrap = wrapRef.current
      if (!wrap) return { ...prev, draftValue: n }
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      const v = topMarkerV(stock, n)
      const { x, y } = uvToScreen(0, v, w, h, stock, zoomRef.current, panRef.current)
      return { ...prev, draftValue: n, sx: x, sy: y }
    })
  }, [stock])

  const applyTopMarkerPanel = useCallback(async (topOffset) => {
    const n = Math.max(0, Math.round(Number(topOffset)))
    const unchanged = topMarkerPanel?.appliedValue === n
    setTopMarkerPanel(null)
    setHoverBubble(null)
    if (unchanged) {
      wireSafeControllerRef.current.top.cancelEdit()
      wrapRef.current?.classList.remove('is-canvas-focused')
      return
    }
    await wireSafeControllerRef.current.top.applyNewValue(topOffset)
  }, [topMarkerPanel?.appliedValue])

  const updateModelGapDraft = useCallback((rawDraft) => {
    const n = Math.max(0, Math.round(Number(rawDraft)))
    if (!Number.isFinite(n)) return
    setModelGapPanel((prev) => (prev ? { ...prev, draftValue: n } : prev))
  }, [])

  const nudgeModelGapDraft = useCallback((dir) => {
    setModelGapPanel((prev) => {
      if (!prev) return prev
      const step = Math.abs(dir) === 1 ? dir : dir
      const n = Math.max(0, Math.round((prev.draftValue ?? 0) + step))
      return { ...prev, draftValue: n }
    })
  }, [])

  const applyModelGapPanel = useCallback(async (gapMm) => {
    const panel = modelGapPanel
    const n = Math.max(0, Math.round(Number(gapMm)))
    setModelGapPanel(null)
    setHoverBubble(null)
    if (panel?.appliedValue === n) {
      modelGapControllerRef.current.managerForZone(panel.zoneType)?.cancelEdit()
      wrapRef.current?.classList.remove('is-canvas-focused')
      return
    }
    const manager = modelGapControllerRef.current.managerForZone(panel?.zoneType)
    await manager?.applyNewValue(n)
  }, [modelGapPanel])

  const closeModelGapPanel = useCallback(() => {
    modelGapControllerRef.current.resetAll()
    setModelGapPanel(null)
    setCanvasFocus(null)
    setHoverBubble(null)
    wrapRef.current?.classList.remove('is-canvas-focused')
    simDrawRef.current?.()
  }, [])

  const updateOriginPositionDraft = useCallback((value) => {
    setOriginPositionPanel((prev) => (prev ? { ...prev, draftValue: value } : prev))
  }, [])

  const applyOriginPositionPanel = useCallback(async (display) => {
    const unchanged = originPositionPanel?.appliedValue === display
    setOriginPositionPanel(null)
    setHoverBubble(null)
    setOriginFocused(false)
    if (unchanged) {
      originManagerRef.current.cancelEdit()
      wrapRef.current?.classList.remove('is-canvas-focused')
      return
    }
    await originManagerRef.current.applyNewPosition(display)
    wrapRef.current?.classList.remove('is-canvas-focused')
    simDrawRef.current?.()
  }, [originPositionPanel?.appliedValue])

  const closeOriginPositionPanel = useCallback(() => {
    originManagerRef.current.cancelEdit()
    setOriginPositionPanel(null)
    setOriginFocused(false)
    setHoverBubble(null)
    wrapRef.current?.classList.remove('is-canvas-focused')
    simDrawRef.current?.()
  }, [])

  const closeBottomMarkerPanel = useCallback(() => {
    wireSafeControllerRef.current.bottom.cancelEdit()
    setBottomMarkerPanel(null)
    setCanvasFocus(null)
    setHoverBubble(null)
    wrapRef.current?.classList.remove('is-canvas-focused')
    simDrawRef.current?.()
  }, [])

  const closeTopMarkerPanel = useCallback(() => {
    wireSafeControllerRef.current.top.cancelEdit()
    setTopMarkerPanel(null)
    setCanvasFocus(null)
    setHoverBubble(null)
    wrapRef.current?.classList.remove('is-canvas-focused')
    simDrawRef.current?.()
  }, [])

  useEffect(() => {
    if (!dimensionEdit) return undefined
    const t = setTimeout(() => dimensionInputRef.current?.select(), 0)
    return () => clearTimeout(t)
  }, [dimensionEdit])

  useEffect(() => {
    const mq = window.matchMedia('(hover: none) and (pointer: coarse)')
    const update = () => setIsCoarsePointer(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    simDrawRef.current?.()
  }, [canvasFocus])

  const activateCanvasFocus = useCallback((focus) => {
    if (!focus) return
    if (focus.dimHit) {
      setDimensionEdit({
        axis: focus.dimHit.axis,
        value: focus.dimHit.value,
        x: focus.dimHit.anchor.x,
        y: focus.dimHit.anchor.y,
      })
      setCanvasFocus(null)
      setHoverBubble(null)
      return
    }
    const hoverHit = focus.hoverHit
    if (!hoverHit) return
    if (hoverHit.kind === HOVER_KIND.ORIGIN) {
      handleOriginClick(hoverHit)
      return
    }
    if (
      (hoverHit.kind === HOVER_KIND.GREEN || hoverHit.kind === HOVER_KIND.RED)
      && hoverHit.marker
    ) {
      const ctx = overlayContextRef.current
      const role = classifyMarker(hoverHit.marker, ctx)
      if (!role) return
      handleWireMarkerClick(hoverHit, role)
    }
  }, [handleOriginClick, handleWireMarkerClick])

  const previewBoMargin = bottomMarkerPanel?.draftValue ?? null
  const previewTopOffset = topMarkerPanel?.draftValue ?? null

  const overlayData = useMemo(
    () => buildOverlayData({
      geometry,
      thetaDeg: activeThetaDeg,
      stock,
      cutMode,
      cutIndex,
      cutJob,
      boMarginOverride: previewBoMargin,
      topOffsetOverride: previewTopOffset,
    }),
    [geometry, activeThetaDeg, stock, cutMode, cutIndex, cutJob, previewBoMargin, previewTopOffset],
  )

  const { contour, cutPath, block, markers, links } = overlayData
  const boV = overlayData.cutBoV
  const annotations = { block, markers, links }

  // Experimental Sim — the full wire travel for this rotation, used only by the
  // animation. Derived from the drawn link lines, so no geometry is recomputed
  // and neither cutPath nor the rendering changes.
  const fullWirePath = useMemo(
    () => buildFullWirePath(cutPath, annotations.markers, OVERLAY_COLORS),
    [cutPath, annotations.markers],
  )

  // Cumulative arc length per vertex, in mm. Playback samples by distance, so
  // this is the only thing that defines position along the travel — there are
  // no index-based fractions left to disagree with it. Rebuilt only when the
  // path changes, never per frame.
  const wireCum = useMemo(() => cumulativeLengths(fullWirePath), [fullWirePath])
  const wireLengthMM = wireCum.length ? wireCum[wireCum.length - 1] : 0

  const drawWireUV = playback?.wireUV
    ?? (simActive && fullWirePath.length >= 2
      ? pointAtDistance(fullWirePath, wireCum, drawSimDistance)
      : null)
    ?? (simActive && fullWirePath[0] ? fullWirePath[0] : null)

  // K point (simDot): next cut's wire entry — always visible on Toolpath.
  // Suppressed on the last rotation — there is no next cut.
  const simDot = useMemo(() => {
    if (!geometry) return null
    return nextSimDot({
      geometry,
      stock,
      rotationN,
      cutMode,
      cutIndex,
      thetaDeg: activeThetaDeg,
    })
  }, [geometry, rotationN, cutMode, cutIndex, stock, activeThetaDeg])

  const originPt = useMemo(
    () => resolveOriginUV(block, stock),
    [block, stock],
  )

  useEffect(() => {
    hoverContextRef.current = {
      markers: annotations.markers,
      simDot,
      originPt,
      cutIndex,
      cutCount,
      stock,
    }
    overlayContextRef.current = {
      block,
      boV,
      cutMode,
      stock,
      geometry,
    }
  }, [annotations.markers, simDot, originPt, cutIndex, cutCount, stock, block, boV, cutMode, geometry])

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const draw = () => {
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      if (w < 10 || h < 10) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      const ctx = canvas.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#f4f6f8'
      ctx.fillRect(0, 0, w, h)

      if (!contour.length) {
        dimensionHitsRef.current = []
        safeZoneHitsRef.current = []
        ctx.fillStyle = '#8892a0'
        ctx.font = '13px system-ui'
        ctx.textAlign = 'center'
        ctx.fillText('No silhouette at this angle', w / 2, h / 2)
        return
      }

      const z = zoomRef.current
      const pn = panRef.current

      const baseScale = overlayStockScale(w, h, stock)
      const scale = baseScale * z
      const X = (u) => w / 2 + u * scale + pn.x
      const Y = (v) => h * 0.8 - v * scale + pn.y

      // Reference axes — world origin guides, drawn behind the silhouette.
      // boV from outer scope — model bbox bottom + BO margin
      const axisX = X(0)
      ctx.setLineDash([6, 5])
      ctx.lineWidth = 1
      ctx.strokeStyle = '#ff0000'
      ctx.beginPath()
      ctx.moveTo(axisX, 0)
      ctx.lineTo(axisX, h)
      ctx.stroke()
      const boY = Y(boV)
      ctx.strokeStyle = '#6ea8ff'
      ctx.beginPath()
      ctx.moveTo(0, boY)
      ctx.lineTo(w, boY)
      ctx.stroke()
      ctx.setLineDash([])

      // Foam block outline — dynamic projected width, centred on the MODEL's
      // projected 3D-bbox centre (not on the rotation axis). Same numbers the
      // 3D Combined overlay draws. Dashed grey, thin, no fill, behind the
      // silhouette.
      const { block } = annotations
      ctx.strokeStyle = '#8a9099'
      ctx.globalAlpha = 0.4
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.strokeRect(
        X(block.leftU), Y(block.topV),
        X(block.rightU) - X(block.leftU), Y(block.bottomV) - Y(block.topV),
      )
      ctx.setLineDash([])
      ctx.globalAlpha = 1

      const topGap = modelTopGapRect(block, contour)
      if (topGap) {
        ctx.fillStyle = OVERLAY_COLORS.modelTopGapFill
        ctx.fillRect(
          X(topGap.leftU),
          Y(topGap.topV),
          X(topGap.rightU) - X(topGap.leftU),
          Y(topGap.bottomV) - Y(topGap.topV),
        )
      }

      const baseGap = modelBaseGapRect(block, contour)
      if (baseGap) {
        ctx.fillStyle = OVERLAY_COLORS.modelBaseGapFill
        ctx.fillRect(
          X(baseGap.leftU),
          Y(baseGap.topV),
          X(baseGap.rightU) - X(baseGap.leftU),
          Y(baseGap.bottomV) - Y(baseGap.topV),
        )
      }

      const safeRegions = buildSafeZoneRegions({ block, contour })
      safeZoneHitsRef.current = safeRegions.map((region) => {
        const screenRect = uvRectToScreen(region.rect, X, Y)
        return {
          ...region,
          screenRect,
          sx: screenRect.x + screenRect.w / 2,
          sy: screenRect.y + screenRect.h / 2,
        }
      })

      const blockLeft = X(block.leftU)
      const blockRight = X(block.rightU)
      const blockTop = Y(block.topV)
      const blockBottom = Y(block.bottomV)
      const { hitTargets: dimHits } = drawFoamBlockDimensions(ctx, {
        left: blockLeft,
        right: blockRight,
        top: blockTop,
        bottom: blockBottom,
        w: stock?.w ?? 0,
        h: stock?.h ?? 0,
      })
      dimensionHitsRef.current = dimHits

      // Silhouette outline — dashed, 50% opacity.
      ctx.setLineDash([5, 4])
      ctx.strokeStyle = '#000000'
      ctx.globalAlpha = 0.5
      ctx.lineWidth = 1.6
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(X(contour[0].u), Y(contour[0].v))
      for (let i = 1; i < contour.length; i++) ctx.lineTo(X(contour[i].u), Y(contour[i].v))
      ctx.closePath()
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.setLineDash([])

      // Cut path
      if (cutPath.length >= 2) {
        ctx.strokeStyle = '#1d5cff'
        ctx.lineWidth = 2
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(X(cutPath[0].u), Y(cutPath[0].v))
        for (let i = 1; i < cutPath.length; i++) ctx.lineTo(X(cutPath[i].u), Y(cutPath[i].v))
        ctx.stroke()
      }

      // Cut-entry / cut-exit markers + lead-in / lead-out link lines.
      // Positions and colours come from the shared overlay module, so the 3D
      // Combined view draws the identical drawing on the fixed MP plane.
      const drawMarkerAt = (px, py, color, dark, size) => {
        ctx.fillStyle = color
        ctx.strokeStyle = dark
        ctx.lineWidth = 1
        ctx.fillRect(px - size / 2, py - size / 2, size, size)
        ctx.strokeRect(px - size / 2, py - size / 2, size, size)
      }

      const drawLink = (x1, y1, x2, y2, color) => {
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        ctx.setLineDash(OVERLAY_LEAD_DASH)
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()
        ctx.setLineDash([])
      }

      for (const link of annotations.links) {
        drawLink(X(link.from.u), Y(link.from.v), X(link.to.u), Y(link.to.v), link.color)
      }
      for (const m of annotations.markers) {
        drawMarkerAt(X(m.u), Y(m.v), m.color, m.dark, m.size)
      }

      const originPtDraw = resolveOriginUV(block, stock)
      if (originPtDraw) {
        const pulse = originManagerRef.current?.isFocused?.()
          ? originPulseScale()
          : 1
        drawOriginAxisGizmo(ctx, X(originPtDraw.u), Y(originPtDraw.v), pulse)
      }

      // Experimental Sim — the next rotation's start point, drawn last so it
      // sits on top of every other element. Three strokes on a 9px square:
      // blue outer, 1px gap, yellow inner, white fill.
      if (simDot) {
        const s = SIM_DOT_SIZE
        ctx.fillStyle = SIM_DOT_FILL
        ctx.fillRect(X(simDot.u) - s / 2, Y(simDot.v) - s / 2, s, s)
        ctx.strokeStyle = SIM_DOT_OUTER
        ctx.lineWidth = 1
        ctx.strokeRect(X(simDot.u) - s / 2, Y(simDot.v) - s / 2, s, s)
        const ins = 2
        ctx.strokeStyle = SIM_DOT_INNER
        ctx.strokeRect(
          X(simDot.u) - s / 2 + ins, Y(simDot.v) - s / 2 + ins,
          s - 2 * ins, s - 2 * ins,
        )
      }

      // Experimental Sim — trail of the ground the marker has already covered.
      // Drawn above the overlay drawing but below the marker itself.
      const trailPoints = useSharedPlayback ? drawTrail : simTrailRef.current
      if (simActive && trailPoints.length >= 2) {
        ctx.strokeStyle = TRAIL_COLOR
        ctx.lineWidth = TRAIL_WIDTH
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(X(trailPoints[0].u), Y(trailPoints[0].v))
        for (let i = 1; i < trailPoints.length; i++) {
          ctx.lineTo(X(trailPoints[i].u), Y(trailPoints[i].v))
        }
        ctx.stroke()
      }

      if (simActive && fullWirePath.length >= 2) {
        const wirePt = drawWireUV
          ?? pointAtDistance(fullWirePath, wireCum, simDistRef.current)
        if (wirePt) {
          const wx = X(wirePt.u)
          const wy = Y(wirePt.v)
          // Never hand the canvas a non-finite coordinate: createRadialGradient
          // throws outright, which would take the whole draw loop down.
          if (isFinite(wx) && isFinite(wy)) {
            const t = (Date.now() / 1000) % WIRE_BLINK_PERIOD
            const phase = Math.sin((t / WIRE_BLINK_PERIOD) * Math.PI * 2)
            const opacity = 0.5 + 0.45 * phase
            const colliding = playback?.colliding ?? false
            const glowColor = colliding ? '#ff2222' : WIRE_GLOW_COLOR

            // Soft halo — a radial gradient standing in for a drop shadow.
            const halo = ctx.createRadialGradient(wx, wy, 0, wx, wy, WIRE_GLOW_R * 2)
            halo.addColorStop(0, glowColor)
            halo.addColorStop(1, colliding ? 'rgba(255, 34, 34, 0)' : 'rgba(255, 69, 0, 0)')
            ctx.globalAlpha = Math.max(0, opacity * 0.45)
            ctx.fillStyle = halo
            ctx.beginPath()
            ctx.arc(wx, wy, WIRE_GLOW_R * 2, 0, Math.PI * 2)
            ctx.fill()

            ctx.globalAlpha = Math.max(0, opacity)
            ctx.fillStyle = glowColor
            ctx.beginPath()
            ctx.arc(wx, wy, WIRE_GLOW_R, 0, Math.PI * 2)
            ctx.fill()

            ctx.fillStyle = WIRE_CORE_COLOR
            ctx.beginPath()
            ctx.arc(wx, wy, WIRE_CORE_R, 0, Math.PI * 2)
            ctx.fill()
            ctx.globalAlpha = 1
          }
        }
      }

      const focusedZone = modelGapControllerRef.current?.focusedZoneType?.()
      const wireFocused = wireSafeControllerRef.current?.isAnyFocused?.()
      if (focusedZone) {
        const zoneScreen = safeZoneHitsRef.current.find((z) => z.zoneType === focusedZone)?.screenRect
        drawSafeZoneFocusFill(ctx, zoneScreen, focusedZone, true)
      } else {
        drawCanvasFocusStroke(
          ctx,
          canvasFocusRef.current?.highlight,
          wireFocused || modelGapControllerRef.current?.isAnyFocused?.(),
        )
      }
    }

    simDrawRef.current = draw
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)

    return () => ro.disconnect()
  }, [contour, cutPath, boV, fullWirePath, wireCum, annotations, stock, stock?.originDisplay, cutIndex, cutMode, activeThetaDeg, zoom, pan, simDot, simActive, useSharedPlayback, drawTrail, drawWireUV, drawSimDistance, playback?.simDistance, playback?.colliding])

  useEffect(() => {
    simDrawRef.current?.()
  }, [stock?.originDisplay])

  // Repaint while sim wire blinks, origin scale-pulses, or a zone/marker is focused.
  useEffect(() => {
    const needsBlink = simActive
      || originFocused
      || modelGapControllerRef.current?.isAnyFocused?.()
      || wireSafeControllerRef.current?.isAnyFocused?.()
    if (!needsBlink) return undefined
    let rafId = 0
    const tick = () => {
      simDrawRef.current?.()
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [simActive, canvasFocus, originFocused])

  // Full-job sim playback: integrate distance along the current cut, then auto-
  // advance to the next playable cut until the job is done.
  useEffect(() => {
    if (useSharedPlayback) return undefined
    if (!simPlaying || fullWirePath.length < 2 || !(wireLengthMM > 0)) return undefined
    let lastFrameAt = null
    let lastLabelAt = -Infinity
    if (simDistRef.current >= wireLengthMM) {
      simDistRef.current = 0
    }
    const step = (now) => {
      if (lastFrameAt == null) lastFrameAt = now
      const dt = Math.max(0, (now - lastFrameAt) / 1000)
      lastFrameAt = now

      const distance = Math.min(
        simDistRef.current + dt * baseSpeedMMPerSec * simSpeedRef.current,
        wireLengthMM,
      )
      simDistRef.current = distance

      const pt = pointAtDistance(fullWirePath, wireCum, distance)
      if (pt) {
        const trail = simTrailRef.current
        const tail = trail[trail.length - 1]
        if (!tail || Math.hypot(pt.u - tail.u, pt.v - tail.v) > 1e-6) {
          trail.push({ u: pt.u, v: pt.v })
        }
      }

      const globalDist = completedLengthRef.current + distance

      if (now - simLastSampleRef.current >= SIM_SAMPLE_MS && pt) {
        simLastSampleRef.current = now
        pushSimLog(simLogRef.current, {
          n: (cutIndex ?? 0) + 1,
          u: +pt.u.toFixed(2),
          v: +pt.v.toFixed(2),
          distance: +globalDist.toFixed(1),
        })
        setSimLogTick(simLogRef.current.length)
      }

      const label = {
        n: (cutIndex ?? 0) + 1,
        u: pt?.u ?? 0,
        v: pt?.v ?? 0,
        distance: globalDist,
      }
      if (now - lastLabelAt >= SIM_SAMPLE_MS) {
        lastLabelAt = now
        setSimLabel(label)
        setSimDistance(distance)
        setSimGlobalDistance(globalDist)
      }

      simDrawRef.current()
      if (distance >= wireLengthMM) {
        completedLengthRef.current += wireLengthMM
        const job = simJobRef.current
        const next = job ? nextPlayableCut(job.cuts, cutIndex) : -1
        if (next >= 0) {
          setSimGlobalDistance(completedLengthRef.current)
          simDistRef.current = 0
          simTrailRef.current = []
          advanceSimCut(next)
          simRafRef.current = null
          return
        }
        const jobTotal = job?.jobTotalLengthMM ?? completedLengthRef.current
        setSimGlobalDistance(jobTotal)
        setSimLabel({ ...label, distance: jobTotal })
        setSimPlaying(false)
        simRafRef.current = null
        return
      }
      simRafRef.current = requestAnimationFrame(step)
    }
    simRafRef.current = requestAnimationFrame(step)
    return () => {
      if (simRafRef.current) cancelAnimationFrame(simRafRef.current)
      simRafRef.current = null
    }
  }, [simPlaying, fullWirePath, wireCum, wireLengthMM, cutIndex, baseSpeedMMPerSec, advanceSimCut, setSimPlaying])

  useEffect(() => {
    if (useSharedPlayback) return
    const autoAdvance = simAutoAdvanceRef.current
    const seeking = simSeekingRef.current

    if (seeking) {
      simSeekingRef.current = false
    } else {
      simDistRef.current = 0
      simTrailRef.current = []
      if (!autoAdvance) {
        simLogRef.current = []
        simLastSampleRef.current = -Infinity
        completedLengthRef.current = 0
        setSimLabel(null)
        setSimLogTick(0)
        setSimDistance(0)
        setSimGlobalDistance(0)
      }
    }
    simDrawRef.current()
  }, [fullWirePath, wireCum, cutIndex, simActive, simAutoAdvanceRef])

  useEffect(() => {
    if (useSharedPlayback) return
    if (!simActive) {
      completedLengthRef.current = 0
    }
  }, [simActive, useSharedPlayback])

  const applyLocalSeek = useCallback((path, cum, localDist) => {
    const d = Math.max(0, localDist)
    simDistRef.current = d
    let i = 0
    while (i < cum.length - 2 && cum[i + 1] < d) i++
    const head = path.slice(0, i + 1)
    const pt = pointAtDistance(path, cum, d)
    simTrailRef.current = pt ? [...head, { u: pt.u, v: pt.v }] : head
    setSimDistance(d)
  }, [])

  /**
   * Scrub to a job-level distance (mm). Jumps to the correct cut and local
   * position so the progress bar runs 0 → jobTotal continuously.
   */
  const seekToGlobal = useCallback(async (globalDist, job = null) => {
    setSimPlaying(false)
    let simJob = job ?? simJobRef.current
    if (!simJob) {
      try {
        simJob = await ensureSimJob()
      } catch {
        return
      }
    }
    const hit = seekGlobal(simJob.cuts, globalDist)
    if (!hit) return

    const cut = simJob.cuts.find((c) => c.cutIndex === hit.cutIndex)
    if (!cut?.playable) return

    completedLengthRef.current = hit.completedLength
    const global = hit.completedLength + hit.localDist
    setSimGlobalDistance(global)
    simLogRef.current = []
    simLastSampleRef.current = -Infinity
    setSimLogTick(0)

    applyLocalSeek(cut.fullWirePath, cut.wireCum, hit.localDist)
    const pt = pointAtDistance(cut.fullWirePath, cut.wireCum, hit.localDist)
    setSimLabel({
      n: hit.cutIndex + 1,
      u: pt?.u ?? 0,
      v: pt?.v ?? 0,
      distance: global,
    })

    if (hit.cutIndex !== cutIndex) {
      simSeekingRef.current = true
      setCutIndexForSimStart(hit.cutIndex)
    } else {
      simDrawRef.current()
    }
  }, [
    applyLocalSeek,
    cutIndex,
    ensureSimJob,
    setCutIndexForSimStart,
    setSimPlaying,
  ])

  const activateCanvasFocusRef = useRef(activateCanvasFocus)
  activateCanvasFocusRef.current = activateCanvasFocus
  const handleWireMarkerClickRef = useRef(handleWireMarkerClick)
  handleWireMarkerClickRef.current = handleWireMarkerClick
  const handleSafeZoneInteractionRef = useRef(handleSafeZoneInteraction)
  handleSafeZoneInteractionRef.current = handleSafeZoneInteraction
  const handleOriginClickRef = useRef(handleOriginClick)
  handleOriginClickRef.current = handleOriginClick

  const trySafeZonePointer = useCallback((clientX, clientY, { direct = false } = {}) => {
    const wrap = wrapRef.current
    if (!wrap) return false
    const rect = wrap.getBoundingClientRect()
    const lx = clientX - rect.left
    const ly = clientY - rect.top
    const zoneHit = pickSafeZoneHit(lx, ly, safeZoneHitsRef.current)
    if (!zoneHit) return false
    return handleSafeZoneInteractionRef.current({
      zoneType: zoneHit.zoneType,
      role: zoneHit.role,
      anchor: zoneHit,
      direct,
    })
  }, [])

  // Zoom / pan interaction handlers (wheel, pointer drag, pinch).
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const zoomAt = (clientX, clientY, factor) => {
      const rect = wrap.getBoundingClientRect()
      const z = zoomRef.current
      const nextZ = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor))
      if (nextZ === z) return
      // Keep the point under the cursor fixed while zooming.
      const cx = clientX - rect.left
      const cy = clientY - rect.top
      const pn = panRef.current
      const nextPan = {
        x: cx - (cx - pn.x) * (nextZ / z),
        y: cy - (cy - pn.y) * (nextZ / z),
      }
      setTransform(nextZ, nextPan)
    }

    // The pan handlers are attached to `wrap`, and the wire simulator bar is
    // rendered INSIDE it. Without this guard a press on a WSB control bubbles
    // here, and `setPointerCapture` retargets the gesture to `wrap` — which
    // both pan the canvas and swallow the control's own click. Ignore anything
    // originating in the bar; the controls keep their normal behaviour.
    const isFromOverlayControl = (e) => !!(
      e.target?.closest?.('.wsb-bar')
      || e.target?.closest?.('.view-hud-stack')
      || e.target?.closest?.('.view-hud-stack--top-right')
      || e.target?.closest?.('.silhouette-zoom-controls')
      || e.target?.closest?.('.canvas-dimension-editor')
      || e.target?.closest?.('.canvas-marker-editor')
      || e.target?.closest?.('.canvas-direction-marker-panel')
      || e.target?.closest?.('.minimap-2d-widget')
      || e.target?.closest?.('.centered-modal-backdrop')
      || e.target?.closest?.('.centered-overlay-panel')
      || e.target?.closest?.('.canvas-hover-bubble')
    )

    const onWheel = (e) => {
      if (isFromOverlayControl(e)) return
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.0015)
      zoomAt(e.clientX, e.clientY, factor)
    }

    const DRAG_THRESHOLD = 4

    const pickHoverTarget = (clientX, clientY) => {
      const ctx = hoverContextRef.current
      const rect = wrap.getBoundingClientRect()
      const w = rect.width
      const h = rect.height
      if (w < 10 || h < 10) return null
      const lx = clientX - rect.left
      const ly = clientY - rect.top
      const targets = buildCanvasHoverTargets({
        ...ctx,
        w,
        h,
        zoom: zoomRef.current,
        pan: panRef.current,
      })
      for (let i = targets.length - 1; i >= 0; i--) {
        if (hitTargetContains(targets[i], lx, ly)) return targets[i]
      }
      return null
    }

    const pickCanvasTargets = (clientX, clientY) => {
      const rect = wrap.getBoundingClientRect()
      const lx = clientX - rect.left
      const ly = clientY - rect.top
      const dimHit = pickFoamDimensionHit(dimensionHitsRef.current, lx, ly)
      const zoneHit = dimHit ? null : pickSafeZoneHit(lx, ly, safeZoneHitsRef.current)
      const hoverHit = (dimHit || zoneHit) ? null : pickHoverTarget(clientX, clientY)
      return { dimHit, hoverHit, zoneHit }
    }

    const useTapToFocus = (e) => (
      e?.pointerType === 'touch' || isCoarsePointerRef.current
    )

    const handleCoarseTap = (clientX, clientY) => {
      const { dimHit, hoverHit, zoneHit } = pickCanvasTargets(clientX, clientY)
      if (!dimHit && !hoverHit && !zoneHit) {
        modelGapControllerRef.current?.resetAll()
        wireSafeControllerRef.current?.resetAll()
        originManagerRef.current?.reset()
        setOriginFocused(false)
        setCanvasFocus(null)
        clearHover()
        wrap.classList.remove('is-canvas-focused')
        simDrawRef.current?.()
        return
      }

      if (zoneHit) {
        if (handleSafeZoneInteractionRef.current({
          zoneType: zoneHit.zoneType,
          role: zoneHit.role,
          anchor: zoneHit,
        })) return
      }

      if (
        hoverHit
        && (hoverHit.kind === HOVER_KIND.GREEN || hoverHit.kind === HOVER_KIND.RED)
        && hoverHit.marker
      ) {
        const role = classifyMarker(hoverHit.marker, overlayContextRef.current)
        if (role && handleWireMarkerClickRef.current(hoverHit, role)) return
      }

      if (hoverHit?.kind === HOVER_KIND.ORIGIN) {
        handleOriginClickRef.current(hoverHit)
        return
      }

      const nextFocus = buildCanvasFocusState(dimHit, hoverHit, overlayContextRef.current)
      if (!nextFocus) return

      if (canvasFocusRef.current?.key === nextFocus.key) {
        activateCanvasFocusRef.current?.(canvasFocusRef.current)
        wrap.classList.remove('is-canvas-focused')
        simDrawRef.current?.()
        return
      }

      setCanvasFocus(nextFocus)
      wrap.classList.add('is-canvas-focused')
      wrap.classList.add('is-dot-hover')
      setHoverBubble({
        kind: nextFocus.kind,
        title: nextFocus.bubble.title,
        lines: nextFocus.bubble.lines,
        x: nextFocus.bubble.x,
        y: nextFocus.bubble.y,
      })
      simDrawRef.current?.()
    }

    const updateHover = (e) => {
      if (isCoarsePointerRef.current) return
      if (originManagerRef.current?.isFocused?.()) return
      if (dragRef.current?.panning) {
        setHoverBubble(null)
        wrap.classList.remove('is-dot-hover')
        wrap.classList.remove('is-safe-zone-hover')
        return
      }
      const rect = wrap.getBoundingClientRect()
      const zoneHit = pickSafeZoneHit(
        e.clientX - rect.left,
        e.clientY - rect.top,
        safeZoneHitsRef.current,
      )
      if (zoneHit) {
        wrap.classList.add('is-dot-hover')
        wrap.classList.add('is-safe-zone-hover')
        setHoverBubble({
          kind: zoneHit.zoneType === SAFE_ZONE.TOP ? HOVER_KIND.SAFE_TOP : HOVER_KIND.SAFE_BOTTOM,
          title: safeZonePanelTitle(zoneHit.zoneType),
          lines: [safeZoneBubbleText(zoneHit.zoneType), 'Click to focus · click again to edit'],
          x: zoneHit.sx,
          y: zoneHit.sy,
        })
        return
      }
      wrap.classList.remove('is-safe-zone-hover')
      const hit = pickHoverTarget(e.clientX, e.clientY)
      if (!hit) {
        setHoverBubble(null)
        wrap.classList.remove('is-dot-hover')
        return
      }
      wrap.classList.add('is-dot-hover')
      setHoverBubble({
        kind: hit.kind,
        title: hit.detail.title,
        lines: hit.detail.lines,
        x: hit.sx,
        y: hit.sy,
      })
    }

    const clearHover = () => {
      setHoverBubble(null)
      wrap.classList.remove('is-dot-hover')
    }

    const onPointerDown = (e) => {
      if (isFromOverlayControl(e)) return
      if (e.pointerType === 'mouse') {
        if (e.button === 1) return // middle + drag: do nothing
        if (e.button !== 0) return // left button only
      }
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        panning: false,
      }
    }

    const onPointerMove = (e) => {
      const d = dragRef.current
      if (!d || d.pointerId !== e.pointerId) {
        updateHover(e)
        return
      }

      if (!d.panning) {
        const totalDx = e.clientX - d.startX
        const totalDy = e.clientY - d.startY
        if (Math.hypot(totalDx, totalDy) < DRAG_THRESHOLD) return
        d.panning = true
        e.preventDefault()
        wrap.setPointerCapture(e.pointerId)
        wrap.classList.add('is-panning')
        if (useTapToFocus(e)) {
          setCanvasFocus(null)
          wrap.classList.remove('is-canvas-focused')
          clearHover()
          simDrawRef.current?.()
        }
        const pn = panRef.current
        setTransform(zoomRef.current, { x: pn.x + totalDx, y: pn.y + totalDy })
        d.x = e.clientX
        d.y = e.clientY
        return
      }

      e.preventDefault()
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      d.x = e.clientX
      d.y = e.clientY
      const pn = panRef.current
      setTransform(zoomRef.current, { x: pn.x + dx, y: pn.y + dy })
      if (!useTapToFocus(e)) clearHover()
    }

    const endPan = (e) => {
      const d = dragRef.current
      if (!d) return
      if (e && e.pointerId && d.pointerId !== e.pointerId) return
      const wasPanning = d.panning
      const pointerType = d.pointerType
      dragRef.current = null
      wrap.classList.remove('is-panning')
      if (wasPanning && e?.pointerId != null) {
        try { wrap.releasePointerCapture(e.pointerId) } catch (_) {}
      }
      if (!wasPanning && e) {
        if (pointerType === 'touch' || isCoarsePointerRef.current) {
          handleCoarseTap(e.clientX, e.clientY)
          return
        }
        if (pointerType === 'mouse') {
          pointerTapEligibleRef.current = true
        }
      }
      if (e) updateHover(e)
    }

    const onClick = (e) => {
      if (isFromOverlayControl(e)) return
      if (!pointerTapEligibleRef.current) return
      pointerTapEligibleRef.current = false
      if (trySafeZonePointer(e.clientX, e.clientY)) return
      const { hoverHit, zoneHit } = pickCanvasTargets(e.clientX, e.clientY)
      if (zoneHit) return
      if (hoverHit?.kind === HOVER_KIND.ORIGIN) {
        handleOriginClickRef.current(hoverHit)
        return
      }
      if (
        hoverHit
        && (hoverHit.kind === HOVER_KIND.GREEN || hoverHit.kind === HOVER_KIND.RED)
        && hoverHit.marker
      ) {
        const role = classifyMarker(hoverHit.marker, overlayContextRef.current)
        if (role) handleWireMarkerClickRef.current(hoverHit, role)
      }
    }

    const onPointerLeave = () => clearHover()

    // Pinch (two-finger) zoom for touch.
    const touchDist = (touches) => Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY,
    )

    const onTouchStart = (e) => {
      if (isFromOverlayControl(e)) return
      if (e.touches.length >= 2) {
        dragRef.current = null
        setCanvasFocus(null)
        wrap.classList.remove('is-canvas-focused')
        clearHover()
        simDrawRef.current?.()
      }
      if (e.touches.length === 2) {
        e.preventDefault()
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2
        pinchRef.current = {
          startDist: touchDist(e.touches),
          startZoom: zoomRef.current,
          lastCx: cx,
          lastCy: cy,
        }
        wrap.classList.add('is-panning')
      }
    }

    const onTouchMove = (e) => {
      const p = pinchRef.current
      if (p && e.touches.length === 2) {
        e.preventDefault()
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2
        const dx = cx - p.lastCx
        const dy = cy - p.lastCy
        p.lastCx = cx
        p.lastCy = cy

        const rect = wrap.getBoundingClientRect()
        const localCx = cx - rect.left
        const localCy = cy - rect.top
        const z = zoomRef.current
        const pn = panRef.current
        let nextPan = { x: pn.x + dx, y: pn.y + dy }

        const dist = touchDist(e.touches)
        const nextZ = p.startDist >= 1
          ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, p.startZoom * (dist / p.startDist)))
          : z
        if (nextZ !== z) {
          nextPan = {
            x: localCx - (localCx - nextPan.x) * (nextZ / z),
            y: localCy - (localCy - nextPan.y) * (nextZ / z),
          }
        }
        setTransform(nextZ, nextPan)
      }
    }

    const onTouchEnd = (e) => {
      if (e.touches.length < 2) {
        pinchRef.current = null
        wrap.classList.remove('is-panning')
      }
    }

    const onDoubleClick = (e) => {
      if (isFromOverlayControl(e)) return
      const rect = wrap.getBoundingClientRect()
      const hit = pickFoamDimensionHit(
        dimensionHitsRef.current,
        e.clientX - rect.left,
        e.clientY - rect.top,
      )
      if (hit) {
        e.preventDefault()
        setDimensionEdit({
          axis: hit.axis,
          value: hit.value,
          x: hit.anchor.x,
          y: hit.anchor.y,
        })
        return
      }
      const zoneHit = pickSafeZoneHit(
        e.clientX - rect.left,
        e.clientY - rect.top,
        safeZoneHitsRef.current,
      )
      if (zoneHit) {
        e.preventDefault()
        handleSafeZoneInteractionRef.current({
          zoneType: zoneHit.zoneType,
          role: zoneHit.role,
          anchor: zoneHit,
          direct: true,
        })
        return
      }
      const hoverHit = pickHoverTarget(e.clientX, e.clientY)
      if (hoverHit?.kind === HOVER_KIND.ORIGIN) {
        e.preventDefault()
        handleOriginClickRef.current(hoverHit, { direct: true })
        return
      }
      if (
        (hoverHit?.kind === HOVER_KIND.GREEN || hoverHit?.kind === HOVER_KIND.RED)
        && hoverHit.marker
      ) {
        e.preventDefault()
        const ctx = overlayContextRef.current
        const role = classifyMarker(hoverHit.marker, ctx)
        if (!role) return
        handleWireMarkerClickRef.current(hoverHit, role, { direct: true })
        return
      }
      resetView()
    }

    wrap.addEventListener('wheel', onWheel, { passive: false })
    wrap.addEventListener('click', onClick)
    wrap.addEventListener('pointerdown', onPointerDown)
    wrap.addEventListener('pointermove', onPointerMove)
    wrap.addEventListener('pointerup', endPan)
    wrap.addEventListener('pointercancel', endPan)
    wrap.addEventListener('pointerleave', onPointerLeave)
    wrap.addEventListener('touchstart', onTouchStart, { passive: false })
    wrap.addEventListener('touchmove', onTouchMove, { passive: false })
    wrap.addEventListener('touchend', onTouchEnd)
    wrap.addEventListener('touchcancel', onTouchEnd)
    wrap.addEventListener('dblclick', onDoubleClick)

    return () => {
      wrap.removeEventListener('wheel', onWheel)
      wrap.removeEventListener('pointerdown', onPointerDown)
      wrap.removeEventListener('pointermove', onPointerMove)
      wrap.removeEventListener('pointerup', endPan)
      wrap.removeEventListener('pointercancel', endPan)
      wrap.removeEventListener('pointerleave', onPointerLeave)
      wrap.removeEventListener('touchstart', onTouchStart)
      wrap.removeEventListener('touchmove', onTouchMove)
      wrap.removeEventListener('touchend', onTouchEnd)
      wrap.removeEventListener('touchcancel', onTouchEnd)
      wrap.removeEventListener('dblclick', onDoubleClick)
      wrap.removeEventListener('click', onClick)
    }
  }, [setTransform, resetView, setDimensionEdit, activateCanvasFocus, trySafeZonePointer])

  // --- WSB-facing derived values -------------------------------------------
  // Status names the run, not the motion: CUTTING means the playhead is
  // advancing, DONE means it reached the end.
  const jobTotalMM = jobTotalLengthMM > 0 ? jobTotalLengthMM : wireLengthMM

  const simStatus = useMemo(() => {
    if (jobTotalMM <= 0) return 'READY'
    if (!simPlaying && simGlobalDistance >= jobTotalMM - 1e-3) return 'DONE'
    if (simPlaying) return 'CUTTING'
    return simGlobalDistance > 0 ? 'PAUSED' : 'READY'
  }, [simGlobalDistance, jobTotalMM, simPlaying])

  const mmss = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
    const total = Math.round(seconds)
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  const simTimeElapsed = mmss(baseSpeedMMPerSec > 0 ? simGlobalDistance / baseSpeedMMPerSec : 0)
  const simTimeTotal = mmss(baseSpeedMMPerSec > 0 ? jobTotalMM / baseSpeedMMPerSec : 0)
  const simPct = jobTotalMM > 0
    ? `${((simGlobalDistance / jobTotalMM) * 100).toFixed(1)}%`
    : '0.0%'

  // --- WSB handlers ---------------------------------------------------------
  // Stop leaves Sim mode entirely, so the bar unmounts and distance resets.
  const handleSimStop = useCallback(() => {
    setSimPlaying(false)
    simDistRef.current = 0
    simTrailRef.current = []
    simLogRef.current = []
    simLastSampleRef.current = -Infinity
    completedLengthRef.current = 0
    setSimDistance(0)
    setSimGlobalDistance(0)
    setSimLabel(null)
    setSimLogTick(0)
    setSimActive(false)
  }, [setSimActive, setSimPlaying])

  const handleSimReset = useCallback(() => {
    setSimPlaying(false)
    simDistRef.current = 0
    simTrailRef.current = []
    simLogRef.current = []
    simLastSampleRef.current = -Infinity
    completedLengthRef.current = 0
    setSimDistance(0)
    setSimGlobalDistance(0)
    setSimLabel(null)
    setSimLogTick(0)
    setCutIndexForSimStart(0)
    simDrawRef.current()
  }, [setCutIndexForSimStart, setSimPlaying])

  const handleTogglePlay = useCallback(async () => {
    if (simPlaying) {
      setSimPlaying(false)
      return
    }
    if (!geometry) return

    const total = jobTotalLengthMM > 0 ? jobTotalLengthMM : wireLengthMM
    const atJobEnd = total > 0 && simGlobalDistance >= total - 1e-3
    const canResume = !atJobEnd
      && simGlobalDistance > 0
      && wireLengthMM > 0
      && fullWirePath.length >= 2
    if (canResume) {
      setSimPlaying(true)
      return
    }

    try {
      const job = await ensureSimJob()
      let startCut = 0
      if (!job.cuts[0]?.playable) {
        startCut = firstPlayableCut(job.cuts)
      }
      if (startCut < 0 || !job.cuts[startCut]?.playable) return
      simDistRef.current = 0
      simTrailRef.current = []
      simLogRef.current = []
      simLastSampleRef.current = -Infinity
      completedLengthRef.current = 0
      setSimLogTick(0)
      setSimDistance(0)
      setSimGlobalDistance(0)
      setSimLabel(null)
      setCutIndexForSimStart(startCut)
      setSimPlaying(true)
    } catch (err) {
      console.warn('[sim] job precompute failed:', err)
    }
  }, [
    ensureSimJob,
    fullWirePath.length,
    geometry,
    jobTotalLengthMM,
    setCutIndexForSimStart,
    setSimPlaying,
    simGlobalDistance,
    simPlaying,
    wireLengthMM,
  ])

  // Speed persists immediately — it is a playback preference, not a committed
  // edit, so there is deliberately no Apply gate on the slider.
  const handleSpeedChange = useCallback((mult) => {
    updateSimSettings?.({ simSpeedMultiplier: Math.min(100, Math.max(1, Math.round(mult))) })
  }, [updateSimSettings])

  const handleScrub = useCallback(async (value) => {
    const total = jobTotalLengthMM > 0
      ? jobTotalLengthMM
      : (simJobRef.current?.jobTotalLengthMM ?? wireLengthMM)
    if (!(total > 0)) return
    await seekToGlobal((value / 1000) * total)
  }, [jobTotalLengthMM, seekToGlobal, wireLengthMM])

  const handleCopyLog = useCallback(async () => {
    const rows = simLogRef.current
    const csv = [
      'N,u,v,distance_mm',
      ...rows.map((r) => `${r.n},${r.u.toFixed(2)},${r.v.toFixed(2)},${r.distance?.toFixed(1) ?? ''}`),
    ].join('\n')
    try {
      await navigator.clipboard.writeText(csv)
      setSimCopied(true)
      setTimeout(() => setSimCopied(false), 500)
    } catch {
      /* clipboard may be unavailable */
    }
  }, [])

  return (
    <section className="silhouette-preview-section">
      <div className="section-label section-label-sub">2D Silhouette Preview (Stage 1)</div>

      <div
        className={`preview-wrap silhouette-preview-canvas-wrap${isCoarsePointer ? ' is-coarse-pointer' : ''}${canvasFocus ? ' is-canvas-focused' : ''}${markerPanelOpen ? ' is-marker-panel-open' : ''}`}
        ref={wrapRef}
      >
        <canvas ref={canvasRef} />
        <Minimap2DOverlay
          stock={stock}
          rotationN={rotationN}
          cutIndex={cutIndex}
          cutMode={cutMode}
        />
        {hoverBubble && (
          <div
            className="canvas-hover-bubble"
            style={{
              left: hoverBubble.x,
              top: hoverBubble.y,
            }}
            role="tooltip"
          >
            <div className="canvas-hover-bubble-title">{hoverBubble.title}</div>
            {hoverBubble.lines?.length > 0 && hoverBubble.lines.map((line) => (
              <div key={line} className="canvas-hover-bubble-line">{line}</div>
            ))}
          </div>
        )}
        {dimensionEdit && (
          <div
            className="canvas-dimension-editor"
            style={{
              left: dimensionEdit.x,
              top: dimensionEdit.y,
            }}
          >
            <input
              ref={dimensionInputRef}
              className="canvas-dimension-input"
              type="number"
              min={1}
              step={1}
              defaultValue={dimensionEdit.value}
              autoFocus
              aria-label={dimensionEdit.axis === 'w' ? 'Foam width (W)' : 'Foam height (H)'}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  confirmDimensionEdit(e.currentTarget.value)
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setDimensionEdit(null)
                }
              }}
              onBlur={(e) => confirmDimensionEdit(e.currentTarget.value)}
            />
            <span className="canvas-dimension-unit">mm</span>
          </div>
        )}
        <DirectionMarkerOverlayPanel
          panel={bottomMarkerPanel}
          onClose={closeBottomMarkerPanel}
          onApply={applyBottomMarkerPanel}
          onDraftChange={updateBottomMarkerDraft}
          onNudge={nudgeBottomMarkerDraft}
        />
        <DirectionMarkerOverlayPanel
          panel={topMarkerPanel}
          onClose={closeTopMarkerPanel}
          onApply={applyTopMarkerPanel}
          onDraftChange={updateTopMarkerDraft}
          onNudge={nudgeTopMarkerDraft}
        />
        <DirectionMarkerOverlayPanel
          panel={modelGapPanel}
          onClose={closeModelGapPanel}
          onApply={applyModelGapPanel}
          onDraftChange={updateModelGapDraft}
          onNudge={nudgeModelGapDraft}
        />
        <OriginPositionOverlayPanel
          panel={originPositionPanel}
          onClose={closeOriginPositionPanel}
          onApply={applyOriginPositionPanel}
          onDraftChange={updateOriginPositionDraft}
        />
        {simActive && drawSimLabel && (
          <button
            type="button"
            className="sim-data-label"
            onClick={() => setSimLogOpen(true)}
            title="Open Sim track log"
          >
            {`N=${drawSimLabel.n}  ${UI_AXES_DISPLAY.xLabel}=${displayCoordX(drawSimLabel.u).toFixed(1)}  `
              + `${UI_AXES_DISPLAY.yLabel}=${displayCoordY(drawSimLabel.v).toFixed(1)}  `
              + `${(drawSimLabel.distance ?? 0).toFixed(0)}mm`}
          </button>
        )}
        <div className="silhouette-zoom-controls">
          <button
            type="button"
            className="silhouette-zoom-btn"
            aria-label="Zoom in"
            onClick={() => setTransform(zoomRef.current * 1.25, panRef.current)}
          >
            +
          </button>
          <button
            type="button"
            className="silhouette-zoom-btn"
            aria-label="Zoom out"
            onClick={() => setTransform(zoomRef.current / 1.25, panRef.current)}
          >
            −
          </button>
          <button
            type="button"
            className="silhouette-zoom-btn silhouette-zoom-reset"
            aria-label="Reset zoom"
            onClick={resetView}
          >
            Reset
          </button>
        </div>
      </div>

      {/* Wire simulator bar — only while Sim mode is on.
          Deliberately a SIBLING of the canvas wrap, not a child: the wrap sets
          `overflow: hidden`, which would clip the bar, and it is also the
          element the pan/zoom pointer handlers are bound to, so nesting the
          controls there made presses pan the canvas. */}
      {simActive && !useSharedPlayback && (
        <WireSimulatorBar
          status={simStatus}
          playing={simPlaying}
          distanceMM={simDistance}
          lengthMM={wireLengthMM}
          jobDistanceMM={simGlobalDistance}
          jobLengthMM={jobTotalMM}
          pct={simPct}
          elapsedLabel={simTimeElapsed}
          totalLabel={simTimeTotal}
          speedMultiplier={speedMultiplier}
          cutReadout={`${cutIndex + 1}/${cutCount}`}
          onGear={onOpenSimPanel}
          onStop={handleSimStop}
          onTogglePlay={handleTogglePlay}
          onReset={handleSimReset}
          onSpeedChange={handleSpeedChange}
          onScrub={handleScrub}
        />
      )}

      <div className="silhouette-preview-footer">
        {contour.length > 0 ? `${contour.length} pts · bins ${GRID_BINS} · ${(zoom * 100).toFixed(0)}%` : '—'}
      </div>

      {simLogOpen && (
        <div className="sim-log-backdrop" role="dialog" aria-label="Sim track log">
          <div className="sim-log-panel">
            <div className="sim-log-header">
              <span className="sim-log-title">
                Sim Track Log
                <span className="sim-log-count">{` · ${simLogTick} rows`}</span>
              </span>
              <button
                type="button"
                className="sim-log-close"
                onClick={() => setSimLogOpen(false)}
                aria-label="Close log"
              >
                ×
              </button>
            </div>
            <div className="sim-log-body">
              <table className="sim-log-table">
                <thead>
                  <tr>
                    <th>N</th><th>u</th><th>v</th><th>mm</th>
                  </tr>
                </thead>
                <tbody>
                  {simLogRef.current.slice(-SIM_LOG_VIEW_ROWS).map((r, i) => (
                    <tr key={i}>
                      <td>{r.n}</td>
                      <td>{r.u.toFixed(2)}</td>
                      <td>{r.v.toFixed(2)}</td>
                      <td>{r.distance?.toFixed(1) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="sim-log-footer">
              <button type="button" className="sim-log-export" onClick={handleCopyLog}>
                {simCopied ? 'Copied' : 'Copy CSV'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  blockSectionHalfWidth,
  blockBottomExtent,
  effectiveBottomSafeOffset,
} from '../lib/toolpath'
import { topSafeY, wirePathFromProfile } from '../lib/wirePath'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 24

/**
 * Section 2 — PathPreviewCanvas (2D WYSIWYG toolpath preview).
 *
 * Draws the vertical cut section through the stock block:
 *  - dynamic Block Boundary (BB) rectangle that grows/shrinks with θ
 *  - LO wire-clearance boundary (dashed)
 *  - LB — dynamic bottom safe point (magenta line + dot)
 *  - left-side cut silhouette from front-to-rear projection (red, Method 1 WYSIWYG)
 *
 * Interaction: wheel / pinch to zoom, drag to pan, double-click to reset fit.
 *
 * Coordinate mapping: X = u (distance along the cutting plane, through the
 * block centre), Y = height above the block base (base on the machine table).
 */
export default function PathPreviewCanvas({ stock, thetaDeg, profile }) {
  const wireProfile = useMemo(() => {
    if (!profile?.polylines?.length) return null
    const path = wirePathFromProfile(profile, stock, thetaDeg)
    return path.length >= 2 ? path : null
  }, [profile, stock, thetaDeg])
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const viewRef = useRef({ zoom: 1, panX: 0, panY: 0 })
  const fitRef = useRef(null)
  const panRef = useRef({ active: false, lastX: 0, lastY: 0, pointerId: null })
  const pinchRef = useRef({ active: false, startDist: 0, startZoom: 1, cx: 0, cy: 0 })

  const resetView = useCallback(() => {
    viewRef.current = { zoom: 1, panX: 0, panY: 0 }
  }, [])

  const requestDraw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
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
    render(ctx, w, h, stock, thetaDeg, profile, wireProfile, viewRef.current, fitRef)
  }, [stock, thetaDeg, profile, wireProfile])

  const zoomAt = useCallback((clientX, clientY, factor) => {
    const wrap = wrapRef.current
    const fit = fitRef.current
    if (!wrap || !fit) return

    const rect = wrap.getBoundingClientRect()
    const sx = clientX - rect.left
    const sy = clientY - rect.top
    const view = viewRef.current
    const scale = fit.baseScale * view.zoom
    const ox = fit.baseOx + view.panX
    const oy = fit.baseOy + view.panY
    const u0 = (sx - ox) / scale
    const v0 = (oy - sy) / scale

    const nextZoom = clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM)
    if (nextZoom === view.zoom) return

    const nextScale = fit.baseScale * nextZoom
    const nextOx = sx - u0 * nextScale
    const nextOy = sy + v0 * nextScale
    viewRef.current = {
      zoom: nextZoom,
      panX: nextOx - fit.baseOx,
      panY: nextOy - fit.baseOy,
    }
    requestDraw()
  }, [requestDraw])

  useEffect(() => {
    resetView()
    requestDraw()
    const raf = requestAnimationFrame(() => requestDraw())
    const t = setTimeout(() => requestDraw(), 150)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(t)
    }
  }, [stock.w, stock.t, stock.h, stock.lo, stock.bo, stock.kerf, stock.topOffset, stock.boAuto, stock.boMargin, resetView, requestDraw])

  useEffect(() => {
    requestDraw()
  }, [thetaDeg, profile, wireProfile, requestDraw])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const ro = new ResizeObserver(() => requestDraw())
    ro.observe(wrap)

    const onWheel = (e) => {
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.0015)
      zoomAt(e.clientX, e.clientY, factor)
    }

    const onPointerDown = (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      if (pinchRef.current.active) return
      panRef.current = { active: true, lastX: e.clientX, lastY: e.clientY, pointerId: e.pointerId }
      wrap.setPointerCapture(e.pointerId)
      wrap.classList.add('is-panning')
    }

    const onPointerMove = (e) => {
      const pan = panRef.current
      if (!pan.active || pan.pointerId !== e.pointerId) return
      const dx = e.clientX - pan.lastX
      const dy = e.clientY - pan.lastY
      pan.lastX = e.clientX
      pan.lastY = e.clientY
      const view = viewRef.current
      viewRef.current = {
        ...view,
        panX: view.panX + dx,
        panY: view.panY + dy,
      }
      requestDraw()
    }

    const endPan = (e) => {
      const pan = panRef.current
      if (!pan.active) return
      if (e && pan.pointerId !== e.pointerId) return
      panRef.current = { active: false, lastX: 0, lastY: 0, pointerId: null }
      wrap.classList.remove('is-panning')
      if (e && e.pointerId != null) wrap.releasePointerCapture(e.pointerId)
    }

    const onDoubleClick = () => {
      resetView()
      requestDraw()
    }

    const touchDist = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX
      const dy = touches[0].clientY - touches[1].clientY
      return Math.hypot(dx, dy)
    }

    const touchCenter = (touches, rect) => ({
      x: (touches[0].clientX + touches[1].clientX) / 2 - rect.left,
      y: (touches[0].clientY + touches[1].clientY) / 2 - rect.top,
    })

    const onTouchStart = (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0]
        panRef.current = { active: true, lastX: t.clientX, lastY: t.clientY, pointerId: 'touch' }
        wrap.classList.add('is-panning')
      } else if (e.touches.length === 2) {
        e.preventDefault()
        panRef.current = { active: false, lastX: 0, lastY: 0, pointerId: null }
        wrap.classList.remove('is-panning')
        const rect = wrap.getBoundingClientRect()
        const center = touchCenter(e.touches, rect)
        pinchRef.current = {
          active: true,
          startDist: touchDist(e.touches),
          startZoom: viewRef.current.zoom,
          cx: center.x + rect.left,
          cy: center.y + rect.top,
        }
      }
    }

    const onTouchMove = (e) => {
      const pinch = pinchRef.current
      if (pinch.active && e.touches.length === 2) {
        e.preventDefault()
        const dist = touchDist(e.touches)
        if (pinch.startDist < 1) return
        const factor = dist / pinch.startDist
        const targetZoom = clamp(pinch.startZoom * factor, MIN_ZOOM, MAX_ZOOM)
        const currentFactor = targetZoom / viewRef.current.zoom
        if (Math.abs(currentFactor - 1) > 0.001) {
          zoomAt(pinch.cx, pinch.cy, currentFactor)
          pinch.startDist = dist
          pinch.startZoom = viewRef.current.zoom
        }
        return
      }

      const pan = panRef.current
      if (!pan.active || e.touches.length !== 1) return
      e.preventDefault()
      const t = e.touches[0]
      const dx = t.clientX - pan.lastX
      const dy = t.clientY - pan.lastY
      pan.lastX = t.clientX
      pan.lastY = t.clientY
      const view = viewRef.current
      viewRef.current = {
        ...view,
        panX: view.panX + dx,
        panY: view.panY + dy,
      }
      requestDraw()
    }

    const onTouchEnd = (e) => {
      if (e.touches.length === 0) {
        pinchRef.current.active = false
        panRef.current = { active: false, lastX: 0, lastY: 0, pointerId: null }
        wrap.classList.remove('is-panning')
      } else if (e.touches.length === 1) {
        pinchRef.current.active = false
        const t = e.touches[0]
        panRef.current = { active: true, lastX: t.clientX, lastY: t.clientY, pointerId: 'touch' }
      }
    }

    wrap.addEventListener('wheel', onWheel, { passive: false })
    wrap.addEventListener('pointerdown', onPointerDown)
    wrap.addEventListener('pointermove', onPointerMove)
    wrap.addEventListener('pointerup', endPan)
    wrap.addEventListener('pointercancel', endPan)
    wrap.addEventListener('dblclick', onDoubleClick)
    wrap.addEventListener('touchstart', onTouchStart, { passive: false })
    wrap.addEventListener('touchmove', onTouchMove, { passive: false })
    wrap.addEventListener('touchend', onTouchEnd)
    wrap.addEventListener('touchcancel', onTouchEnd)

    return () => {
      ro.disconnect()
      wrap.removeEventListener('wheel', onWheel)
      wrap.removeEventListener('pointerdown', onPointerDown)
      wrap.removeEventListener('pointermove', onPointerMove)
      wrap.removeEventListener('pointerup', endPan)
      wrap.removeEventListener('pointercancel', endPan)
      wrap.removeEventListener('dblclick', onDoubleClick)
      wrap.removeEventListener('touchstart', onTouchStart)
      wrap.removeEventListener('touchmove', onTouchMove)
      wrap.removeEventListener('touchend', onTouchEnd)
      wrap.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [requestDraw, resetView, zoomAt])

  return (
    <div className="preview-wrap preview-wrap--interactive" ref={wrapRef}>
      <canvas ref={canvasRef} />
    </div>
  )
}

function render(ctx, width, height, stock, thetaDeg, profile, wireProfile, view, fitRef) {
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#10141b'
  ctx.fillRect(0, 0, width, height)

  const { w: W, t: T, h: H, lo: LO, bo: BO } = stock

  const halfW = blockSectionHalfWidth(thetaDeg, { w: W, t: T })
  const bbExtent = blockBottomExtent(thetaDeg, { w: W, t: T, lo: LO })
  const lb = effectiveBottomSafeOffset(thetaDeg, { w: W, t: T, lo: LO, bo: BO, boAuto: stock.boAuto, boMargin: stock.boMargin })

  const topY = topSafeY(stock)
  // Fit window: cap depth below base so auto-LB does not zoom everything out on mobile
  const fitMinV = -Math.min(lb, Math.max(60, H * 0.12))
  let minU = -halfW - LO - lb * 0.2
  let maxU = halfW + LO + lb * 0.2
  let minV = fitMinV
  let maxV = Math.max(H + LO, topY + LO * 0.5)

  const drawPaths = wireProfile ? [wireProfile] : profile?.polylines ?? []
  if (drawPaths.length) {
    for (const poly of drawPaths) {
      for (const p of poly) {
        if (p.u < minU) minU = p.u
        if (p.u > maxU) maxU = p.u
        if (p.v < minV) minV = p.v
        if (p.v > maxV) maxV = p.v
      }
    }
  }

  const spanU = Math.max(maxU - minU, 1)
  const spanV = Math.max(maxV - minV, 1)
  const padPx = Math.min(width, height) * 0.08
  const availW = Math.max(1, width - padPx * 2)
  const availH = Math.max(1, height - padPx * 2)
  let baseScale = Math.min(availW / spanU, availH / spanV)
  if (!Number.isFinite(baseScale) || baseScale <= 0) baseScale = 0.01
  const centerU = (minU + maxU) / 2
  const centerV = (minV + maxV) / 2
  const baseOx = width / 2 - centerU * baseScale
  const baseOy = height / 2 + centerV * baseScale

  fitRef.current = { baseScale, baseOx, baseOy, centerU, centerV }

  const scale = baseScale * view.zoom
  const ox = baseOx + view.panX
  const oy = baseOy + view.panY
  const X = (u) => ox + u * scale
  const Y = (v) => oy - v * scale

  ctx.strokeStyle = 'rgba(120,150,190,0.08)'
  ctx.lineWidth = 1
  const step = niceStep(Math.max(spanU, spanV) / 8)
  for (let u = Math.ceil(minU / step) * step; u <= maxU; u += step) {
    ctx.beginPath()
    ctx.moveTo(X(u), 0)
    ctx.lineTo(X(u), height)
    ctx.stroke()
  }
  for (let v = Math.ceil(minV / step) * step; v <= maxV; v += step) {
    ctx.beginPath()
    ctx.moveTo(0, Y(v))
    ctx.lineTo(width, Y(v))
    ctx.stroke()
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 1
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(0, Y(0))
  ctx.lineTo(width, Y(0))
  ctx.stroke()
  label(ctx, 'base Y=0', 4, Y(0) - 4, 'rgba(255,255,255,0.5)', 10)

  const bx0 = X(-halfW)
  const bx1 = X(halfW)
  const by0 = Y(0)
  const by1 = Y(H)
  ctx.fillStyle = 'rgba(80,130,220,0.10)'
  ctx.fillRect(bx0, by1, bx1 - bx0, by0 - by1)
  ctx.strokeStyle = '#6ea8ff'
  ctx.lineWidth = 1.6
  ctx.setLineDash([])
  ctx.strokeRect(bx0, by1, bx1 - bx0, by0 - by1)
  label(ctx, `BB ${(halfW * 2).toFixed(1)} × ${H}mm`, bx0 + 4, by0 - 6, '#6ea8ff', 10)

  ctx.strokeStyle = '#5fd3a0'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.strokeRect(X(-halfW - LO), Y(H + LO), X(halfW + LO) - X(-halfW - LO), Y(0) - Y(H + LO))
  ctx.setLineDash([])

  const lbY = Y(-lb)
  if (lbY >= -20 && lbY <= height + 20) {
    ctx.strokeStyle = '#ff5fa8'
    ctx.lineWidth = 1.4
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    ctx.moveTo(0, lbY)
    ctx.lineTo(width, lbY)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#ff5fa8'
    ctx.beginPath()
    ctx.arc(X(0), lbY, 4, 0, Math.PI * 2)
    ctx.fill()
    label(
      ctx,
      `LB = ${lb < 100 ? lb.toFixed(2) : lb.toFixed(1)}mm${stock.boAuto !== false ? ' (auto)' : ` (BB ${bbExtent < 100 ? bbExtent.toFixed(2) : bbExtent.toFixed(1)} + BO ${BO})`}`,
      4,
      Math.max(14, Math.min(lbY - 6, height - 4)),
      '#ff5fa8',
      10,
    )
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.setLineDash([2, 6])
  ctx.beginPath()
  ctx.moveTo(X(0), 0)
  ctx.lineTo(X(0), height)
  ctx.stroke()
  ctx.setLineDash([])

  const topSafeLineY = Y(topY)
  ctx.strokeStyle = 'rgba(255,200,80,0.55)'
  ctx.lineWidth = 1.2
  ctx.setLineDash([5, 5])
  ctx.beginPath()
  ctx.moveTo(0, topSafeLineY)
  ctx.lineTo(width, topSafeLineY)
  ctx.stroke()
  ctx.setLineDash([])
  label(
    ctx,
    `Top safe Y = ${topY.toFixed(1)} (H + ${stock.topOffset ?? 20})`,
    4,
    topSafeLineY - 6,
    'rgba(255,200,80,0.85)',
    10,
  )

  if (wireProfile || profile) {
    const polylines = wireProfile ? [wireProfile] : profile.polylines
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    for (const poly of polylines) {
      if (poly.length < 2) continue
      ctx.beginPath()
      ctx.moveTo(X(poly[0].u), Y(poly[0].v))
      for (let i = 1; i < poly.length; i++) ctx.lineTo(X(poly[i].u), Y(poly[i].v))
      ctx.strokeStyle = '#e84040'
      ctx.lineWidth = 2.5
      ctx.stroke()
    }
    if (polylines.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)'
      ctx.font = '12px system-ui'
      ctx.textAlign = 'center'
      ctx.fillText('No left silhouette at this angle', width / 2, height / 2)
      ctx.textAlign = 'left'
    }
  }

  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.font = '11px ui-monospace, monospace'
  ctx.textAlign = 'right'
  ctx.fillText(`cut θ = ${thetaDeg.toFixed(1)}°`, width - 8, 16)
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.fillText('left cut wire · kerf compensated', width - 8, 30)
  if (view.zoom !== 1 || view.panX !== 0 || view.panY !== 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.fillText(`${Math.round(view.zoom * 100)}% · dbl-click fit`, width - 8, 44)
  }
  ctx.textAlign = 'left'
}

function label(ctx, text, x, y, color, size = 11) {
  ctx.font = `${size}px ui-monospace, monospace`
  ctx.fillStyle = color
  ctx.textBaseline = 'bottom'
  ctx.fillText(text, x, y)
}

function niceStep(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  let step
  if (norm < 1.5) step = 1
  else if (norm < 3.5) step = 2
  else if (norm < 7.5) step = 5
  else step = 10
  return step * mag
}


function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

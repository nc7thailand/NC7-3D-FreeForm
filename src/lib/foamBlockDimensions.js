/** CAD-style foam block dimension graphics for the 2D toolpath canvas. */

export const FOAM_DIM = {
  COLOR: '#5c6570',
  GAP: 14,
  TICK: 5,
  FONT: '11px system-ui, sans-serif',
  LABEL_PAD: 3,
}

function drawDimTick(ctx, x, y, alongAngle) {
  const half = FOAM_DIM.TICK
  const nx = Math.cos(alongAngle + Math.PI / 2)
  const ny = Math.sin(alongAngle + Math.PI / 2)
  ctx.beginPath()
  ctx.moveTo(x - nx * half, y - ny * half)
  ctx.lineTo(x + nx * half, y + ny * half)
  ctx.stroke()
}

/**
 * Draw W (bottom) and H (right-middle) dimensions; return hit targets for editing.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ left:number, right:number, top:number, bottom:number, w:number, h:number }} layout
 * @returns {{ hitTargets: Array<{ axis:'w'|'h', value:number, label:string, hitRect: object, anchor: object }> }}
 */
export function drawFoamBlockDimensions(ctx, { left, right, top, bottom, w, h }) {
  const { COLOR, GAP, FONT, LABEL_PAD } = FOAM_DIM
  const hitTargets = []

  ctx.save()
  ctx.strokeStyle = COLOR
  ctx.fillStyle = COLOR
  ctx.lineWidth = 1
  ctx.setLineDash([])
  ctx.font = FONT

  // X / W — below the foam block
  const xDimY = bottom + GAP
  ctx.beginPath()
  ctx.moveTo(left, bottom)
  ctx.lineTo(left, xDimY + 4)
  ctx.moveTo(right, bottom)
  ctx.lineTo(right, xDimY + 4)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(left, xDimY)
  ctx.lineTo(right, xDimY)
  ctx.stroke()
  drawDimTick(ctx, left, xDimY, 0)
  drawDimTick(ctx, right, xDimY, 0)

  const wLabel = `${Math.round(w)} mm`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const xMid = (left + right) / 2
  ctx.fillText(wLabel, xMid, xDimY + LABEL_PAD)
  const wMetrics = ctx.measureText(wLabel)
  hitTargets.push({
    axis: 'w',
    value: w,
    label: wLabel,
    anchor: { x: xMid, y: xDimY + LABEL_PAD },
    hitRect: {
      x: xMid - wMetrics.width / 2 - 8,
      y: xDimY - 4,
      w: wMetrics.width + 16,
      h: 22,
    },
  })

  // Y / H — right-middle of the foam block
  const yDimX = right + GAP
  ctx.beginPath()
  ctx.moveTo(right, top)
  ctx.lineTo(yDimX + 4, top)
  ctx.moveTo(right, bottom)
  ctx.lineTo(yDimX + 4, bottom)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(yDimX, top)
  ctx.lineTo(yDimX, bottom)
  ctx.stroke()
  drawDimTick(ctx, yDimX, top, Math.PI / 2)
  drawDimTick(ctx, yDimX, bottom, Math.PI / 2)

  const hLabel = `${Math.round(h)} mm`
  const yMid = (top + bottom) / 2
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(hLabel, yDimX + LABEL_PAD + 2, yMid)
  const hMetrics = ctx.measureText(hLabel)
  hitTargets.push({
    axis: 'h',
    value: h,
    label: hLabel,
    anchor: { x: yDimX + LABEL_PAD + 2, y: yMid },
    hitRect: {
      x: yDimX - 4,
      y: yMid - 11,
      w: hMetrics.width + 20,
      h: 22,
    },
  })

  ctx.restore()
  return { hitTargets }
}

/** Pick a dimension hit target from wrap-local pointer coordinates. */
export function pickFoamDimensionHit(hitTargets, lx, ly) {
  if (!hitTargets?.length) return null
  for (let i = hitTargets.length - 1; i >= 0; i--) {
    const t = hitTargets[i]
    const r = t.hitRect
    if (lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h) return t
  }
  return null
}

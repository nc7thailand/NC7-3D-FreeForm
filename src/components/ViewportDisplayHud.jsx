import React from 'react'

/**
 * Center-top overlay — viewport display shell stats (not toolpath compute).
 */
export default function ViewportDisplayHud({ stats, visible = true }) {
  if (!visible || !stats) return null

  const displayLabel = stats.displayTriangles != null
    ? stats.displayTriangles.toLocaleString()
    : '…'
  const sourceLabel = stats.sourceTriangles?.toLocaleString() ?? '—'
  const heapLabel = stats.heapMiB != null ? `${stats.heapMiB} MiB heap` : 'heap n/a'
  const cacheLabel = stats.viewMode === 'lo'
    ? (stats.cached ? 'proxy cached' : 'building proxy…')
    : 'full mesh'
  const buildLabel = stats.buildMs != null && stats.buildMs > 0
    ? `${stats.buildMs} ms swap`
    : 'instant'

  return (
    <div className="viewport-display-hud" aria-live="polite">
      <span className="viewport-display-hud-pill viewport-display-hud-pill--mode">
        View {stats.viewMode === 'hi' ? 'Hi' : 'Lo'}
      </span>
      <span className="viewport-display-hud-pill">
        Display {displayLabel} tris
      </span>
      <span className="viewport-display-hud-pill">
        Source {sourceLabel} tris
      </span>
      <span className="viewport-display-hud-pill">{cacheLabel}</span>
      <span className="viewport-display-hud-pill">{buildLabel}</span>
      <span className="viewport-display-hud-pill">{heapLabel}</span>
      <span className="viewport-display-hud-pill viewport-display-hud-pill--ok">1 mesh</span>
    </div>
  )
}

import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

const PANEL_EDGE_PAD = 12

function measureClipShift(panelEl) {
  if (!panelEl) return 0
  const rect = panelEl.getBoundingClientRect()
  const stepper = document.querySelector('.stepper')
  const minTop = stepper
    ? stepper.getBoundingClientRect().bottom + 8
    : PANEL_EDGE_PAD
  const wrap = panelEl.offsetParent
  const wrapTop = wrap?.getBoundingClientRect?.().top ?? 0
  const floor = Math.max(minTop, wrapTop + PANEL_EDGE_PAD)
  return Math.max(0, floor - rect.top)
}

/**
 * Canvas overlay for green/red direction markers — vertical stack:
 * caption → field label → input → nudge / apply row.
 */
export default function DirectionMarkerOverlayPanel({
  panel,
  onClose,
  onApply,
  onDraftChange,
  onNudge,
  onEnsureVisible,
}) {
  const inputRef = useRef(null)
  const panelRef = useRef(null)

  const ensurePanelVisible = useCallback(() => {
    if (!onEnsureVisible) return
    const shift = measureClipShift(panelRef.current)
    if (shift > 1) onEnsureVisible(shift)
  }, [onEnsureVisible])

  useEffect(() => {
    if (!panel) return undefined
    const t = setTimeout(() => inputRef.current?.select(), 0)
    return () => clearTimeout(t)
  }, [panel?.key])

  useLayoutEffect(() => {
    if (!panel) return
    ensurePanelVisible()
  }, [panel, panel?.key, panel?.sx, panel?.sy, panel?.draftValue, ensurePanelVisible])

  useEffect(() => {
    if (!panel) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel, onClose])

  if (!panel) return null

  const draft = panel.draftValue ?? 20
  const inputId = `direction-marker-${panel.placement}-input`

  const commitDraft = () => {
    const n = Math.max(0, Math.round(Number(draft)))
    if (!Number.isFinite(n)) return
    if (n === panel.appliedValue) {
      onClose()
      return
    }
    onApply(n)
  }

  const handleNudge = (step) => {
    onNudge(step)
    requestAnimationFrame(() => {
      requestAnimationFrame(ensurePanelVisible)
    })
  }

  return (
    <div
      ref={panelRef}
      className={`canvas-direction-marker-panel canvas-direction-marker-panel--${panel.placement}`}
      style={{ left: panel.sx, top: panel.sy }}
      role="dialog"
      aria-modal="true"
      aria-label={panel.panelTitle ?? panel.caption}
    >
      <div className="canvas-direction-marker-caption">
        <span
          className={`canvas-direction-marker-dot canvas-direction-marker-dot--${panel.kind === 'greenDot' ? 'green' : 'red'}`}
          aria-hidden
        />
        {panel.panelTitle ?? panel.caption}
      </div>

      <label className="canvas-direction-marker-label" htmlFor={inputId}>
        {panel.fieldLabel}
      </label>

      <div className="canvas-direction-marker-input-row">
        <input
          ref={inputRef}
          id={inputId}
          className="canvas-dimension-input canvas-direction-marker-input"
          type="number"
          min={0}
          step={1}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitDraft()
            }
          }}
        />
        <span className="canvas-dimension-unit">mm</span>
      </div>

      <div className="canvas-direction-marker-actions">
        <button
          type="button"
          className="canvas-direction-marker-nudge canvas-direction-marker-nudge--step5"
          onClick={() => handleNudge(-5)}
          aria-label="Decrease 5 mm"
          title="Decrease 5 mm"
        >
          --
        </button>
        <button
          type="button"
          className="canvas-direction-marker-nudge"
          onClick={() => handleNudge(-1)}
          aria-label={panel.nudgeDownLabel ?? 'Decrease 1 unit'}
          title={panel.nudgeDownLabel ?? 'Decrease 1 mm'}
        >
          −
        </button>
        <button
          type="button"
          className="canvas-direction-marker-apply"
          onClick={commitDraft}
        >
          Apply
        </button>
        <button
          type="button"
          className="canvas-direction-marker-nudge"
          onClick={() => handleNudge(1)}
          aria-label={panel.nudgeUpLabel ?? 'Increase 1 unit'}
          title={panel.nudgeUpLabel ?? 'Increase 1 mm'}
        >
          +
        </button>
        <button
          type="button"
          className="canvas-direction-marker-nudge canvas-direction-marker-nudge--step5"
          onClick={() => handleNudge(5)}
          aria-label="Increase 5 mm"
          title="Increase 5 mm"
        >
          ++
        </button>
      </div>
    </div>
  )
}

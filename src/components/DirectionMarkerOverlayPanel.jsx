import React, { useEffect, useRef } from 'react'
import CenteredModalOverlay from './CenteredModalOverlay'

/**
 * Modal overlay for direction markers, model gaps, and similar numeric edits.
 */
export default function DirectionMarkerOverlayPanel({
  panel,
  onClose,
  onApply,
  onDraftChange,
  onNudge,
}) {
  const inputRef = useRef(null)

  useEffect(() => {
    if (!panel) return undefined
    const t = setTimeout(() => inputRef.current?.select(), 0)
    return () => clearTimeout(t)
  }, [panel?.key])

  const draft = panel?.draftValue ?? 20
  const inputId = panel ? `direction-marker-${panel.placement}-input` : 'direction-marker-input'

  const commitDraft = () => {
    if (!panel) return
    const n = Math.max(0, Math.round(Number(draft)))
    if (!Number.isFinite(n)) return
    if (n === panel.appliedValue) {
      onClose()
      return
    }
    onApply(n)
  }

  return (
    <CenteredModalOverlay
      open={!!panel}
      title={panel?.panelTitle ?? panel?.caption ?? 'Edit value'}
      ariaLabel={panel?.panelTitle ?? panel?.caption}
      onClose={onClose}
    >
      {panel && (
        <>
          <div className="centered-overlay-caption">
            <span
              className={`canvas-direction-marker-dot canvas-direction-marker-dot--${panel.kind === 'greenDot' ? 'green' : 'red'}`}
              aria-hidden
            />
            {panel.caption}
          </div>

          <label className="centered-overlay-label" htmlFor={inputId}>
            {panel.fieldLabel}
          </label>

          <div className="centered-overlay-input-row">
            <input
              ref={inputRef}
              id={inputId}
              className="canvas-dimension-input centered-overlay-input"
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

          <div className="centered-overlay-actions centered-overlay-actions--spread">
            <button
              type="button"
              className="canvas-direction-marker-nudge canvas-direction-marker-nudge--step5"
              onClick={() => onNudge(-5)}
              aria-label="Decrease 5 mm"
            >
              --
            </button>
            <button
              type="button"
              className="canvas-direction-marker-nudge"
              onClick={() => onNudge(-1)}
              aria-label={panel.nudgeDownLabel ?? 'Decrease 1 mm'}
            >
              −
            </button>
            <button type="button" className="centered-overlay-apply" onClick={commitDraft}>
              Apply
            </button>
            <button
              type="button"
              className="canvas-direction-marker-nudge"
              onClick={() => onNudge(1)}
              aria-label={panel.nudgeUpLabel ?? 'Increase 1 mm'}
            >
              +
            </button>
            <button
              type="button"
              className="canvas-direction-marker-nudge canvas-direction-marker-nudge--step5"
              onClick={() => onNudge(5)}
              aria-label="Increase 5 mm"
            >
              ++
            </button>
          </div>
        </>
      )}
    </CenteredModalOverlay>
  )
}

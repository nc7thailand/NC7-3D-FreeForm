import React, { useEffect, useRef } from 'react'
import CenteredModalOverlay from './CenteredModalOverlay'

const ORIGIN_OPTIONS = [
  { value: 'top', label: 'Top of the foam block' },
  { value: 'bottom', label: 'Bottom of the foam block' },
]

/**
 * Modal overlay for selecting origin position (top / bottom of foam block).
 */
export default function OriginPositionOverlayPanel({
  panel,
  onClose,
  onApply,
  onDraftChange,
}) {
  const selectRef = useRef(null)

  useEffect(() => {
    if (!panel) return undefined
    const t = setTimeout(() => selectRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [panel?.key])

  const commitDraft = () => {
    if (!panel) return
    const value = panel.draftValue ?? 'bottom'
    if (value === panel.appliedValue) {
      onClose()
      return
    }
    onApply(value)
  }

  return (
    <CenteredModalOverlay
      open={!!panel}
      title="Select Origin Position"
      ariaLabel="Select origin position"
      onClose={onClose}
    >
      {panel && (
        <>
          <label className="centered-overlay-label" htmlFor="origin-position-select">
            Origin position
          </label>
          <select
            ref={selectRef}
            id="origin-position-select"
            className="centered-overlay-select"
            value={panel.draftValue ?? 'bottom'}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitDraft()
              }
            }}
          >
            {ORIGIN_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="centered-overlay-actions">
            <button type="button" className="centered-overlay-apply" onClick={commitDraft}>
              Apply
            </button>
          </div>
        </>
      )}
    </CenteredModalOverlay>
  )
}

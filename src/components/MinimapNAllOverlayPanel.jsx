import React, { useEffect, useRef } from 'react'
import { clampRotationN } from '../lib/cutJob.js'
import CenteredModalOverlay from './CenteredModalOverlay'

/**
 * Centered modal for editing total rotation N (N all) from the 2D minimap.
 */
export default function MinimapNAllOverlayPanel({
  open,
  draftValue,
  appliedValue,
  onDraftChange,
  onApply,
  onClose,
}) {
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const t = setTimeout(() => inputRef.current?.select(), 0)
    return () => clearTimeout(t)
  }, [open])

  const commit = () => {
    const n = clampRotationN(Number(draftValue))
    if (!Number.isFinite(n)) return
    if (n === appliedValue) {
      onClose()
      return
    }
    onApply(n)
  }

  return (
    <CenteredModalOverlay
      open={open}
      title="Edit Total N Count (N all)"
      ariaLabel="Edit total N count"
      onClose={onClose}
    >
      <label className="centered-overlay-label" htmlFor="minimap-nall-input">
        N all
      </label>
      <div className="centered-overlay-input-row">
        <input
          ref={inputRef}
          id="minimap-nall-input"
          className="canvas-dimension-input centered-overlay-input"
          type="number"
          min={3}
          max={64}
          step={1}
          value={draftValue}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
        />
      </div>
      <div className="centered-overlay-actions">
        <button type="button" className="centered-overlay-apply" onClick={commit}>
          Apply
        </button>
      </div>
    </CenteredModalOverlay>
  )
}

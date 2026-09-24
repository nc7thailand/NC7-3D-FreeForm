import React, { useEffect, useRef, useState } from 'react'
import { useAppState } from '../context/AppState'
import CenteredModalOverlay from './CenteredModalOverlay'

/**
 * Origin overlay — centered modal for the 2D preview HUD button.
 */
export default function OriginOverlayPanel({ open, onClose }) {
  const { stock, applyOriginDisplaySettings } = useAppState()
  const [draftOrigin, setDraftOrigin] = useState('bottom')
  const selectRef = useRef(null)

  useEffect(() => {
    if (open) setDraftOrigin(stock.originDisplay ?? 'bottom')
  }, [open, stock.originDisplay])

  useEffect(() => {
    if (!open) return undefined
    const t = setTimeout(() => selectRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  const handleApply = async () => {
    const applied = stock.originDisplay ?? 'bottom'
    onClose()
    if (draftOrigin === applied) return
    await applyOriginDisplaySettings({
      originDisplay: draftOrigin,
      originU: undefined,
      originV: undefined,
    })
  }

  return (
    <CenteredModalOverlay
      open={open}
      title="Origin"
      ariaLabel="Origin display"
      onClose={onClose}
    >
      <label className="centered-overlay-label" htmlFor="origin-display-select">
        Select Origin position
      </label>
      <select
        ref={selectRef}
        id="origin-display-select"
        className="centered-overlay-select"
        value={draftOrigin}
        onChange={(e) => setDraftOrigin(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            handleApply()
          }
        }}
      >
        <option value="top">Top of the foam block</option>
        <option value="bottom">Bottom of the foam block</option>
      </select>
      <p className="centered-overlay-hint">
        Shows an origin marker at the middle of the foam block&apos;s{' '}
        {draftOrigin === 'top' ? 'top' : 'bottom'} edge in the 2D view.
      </p>
      <div className="centered-overlay-actions">
        <button type="button" className="centered-overlay-apply" onClick={handleApply}>
          Apply
        </button>
      </div>
    </CenteredModalOverlay>
  )
}

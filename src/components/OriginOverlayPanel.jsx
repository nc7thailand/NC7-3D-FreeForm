import React, { useEffect, useState } from 'react'
import { useAppState } from '../context/AppState'

/**
 * Origin overlay — viewport HUD panel for the 2D preview.
 * Draft-only: the origin marker position commits on Apply.
 */
export default function OriginOverlayPanel({ open, onClose }) {
  const { stock, handleStockChange } = useAppState()
  const [draftOrigin, setDraftOrigin] = useState('bottom')

  useEffect(() => {
    if (open) setDraftOrigin(stock.originDisplay ?? 'bottom')
  }, [open, stock.originDisplay])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const handleApply = () => {
    handleStockChange('originDisplay', draftOrigin)
    onClose()
  }

  return (
    <>
      <div className="backdrop setup-backdrop origin-overlay-backdrop" aria-hidden onClick={onClose} />
      <div
        className="origin-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Origin display"
      >
        <div className="origin-overlay-header">
          <h2>Origin</h2>
          <button type="button" className="origin-overlay-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="origin-overlay-row">
          <label htmlFor="origin-display-select">Select Origin position</label>
          <select
            id="origin-display-select"
            className="origin-overlay-select"
            value={draftOrigin}
            onChange={(e) => setDraftOrigin(e.target.value)}
          >
            <option value="top">Foam Block Top</option>
            <option value="bottom">Foam Block Bottom</option>
          </select>
        </div>

        <p className="origin-overlay-hint">
          Shows an origin marker at the middle of the foam block&apos;s{' '}
          {draftOrigin === 'top' ? 'top' : 'bottom'} edge in the 2D view.
        </p>

        <div className="origin-overlay-actions">
          <button
            type="button"
            className="origin-overlay-btn origin-overlay-apply"
            onClick={handleApply}
          >
            Apply
          </button>
        </div>
      </div>
    </>
  )
}

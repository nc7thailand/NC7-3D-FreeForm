import React, { useEffect, useState } from 'react'
import ToolpathParametersForm from './ToolpathParametersForm'
import { useAppState } from '../context/AppState'

/**
 * Toolpath Setup modal (gear icon). Draft-only: edits accumulate in a local
 * `draftStock` and take effect only on Apply. Reset restores the applied stock.
 */
export default function ToolpathSetupOverlay({ open, onClose }) {
  const { stock, commitStock } = useAppState()
  const [draftStock, setDraftStock] = useState(null)
  const [applying, setApplying] = useState(false)

  // Seed draft from applied stock each time the panel opens.
  useEffect(() => {
    if (open) setDraftStock({ ...stock })
  }, [open, stock])

  if (!open || !draftStock) return null

  const dirty = Object.keys(stock).some((k) => stock[k] !== draftStock[k])

  const updateDraft = (key, value) => {
    setDraftStock((prev) => ({ ...prev, [key]: value }))
  }

  const handleApply = async () => {
    setApplying(true)
    try {
      await commitStock(draftStock)
    } finally {
      setApplying(false)
    }
  }

  const handleReset = () => {
    setDraftStock({ ...stock })
  }

  return (
    <>
      <div className="backdrop setup-backdrop" onClick={onClose} aria-hidden />
      <div className="setup-overlay" role="dialog" aria-label="Toolpath setup">
        <div className="setup-overlay-header">
          <h2>Toolpath Setup</h2>
          <button type="button" className="setup-overlay-close" onClick={onClose} aria-label="Close setup">
            ✕
          </button>
        </div>
        <p className="setup-overlay-sub">Foam block &amp; wire offsets (Method 1)</p>

        <ToolpathParametersForm compact value={draftStock} onChange={updateDraft} />

        {dirty && (
          <p className="setup-overlay-dirty">Unsaved changes — click Apply to apply</p>
        )}

        <div className="setup-overlay-actions">
          <button
            type="button"
            className="setup-overlay-btn setup-overlay-apply"
            onClick={handleApply}
            disabled={applying || !dirty}
          >
            {applying ? 'Applying…' : 'Apply'}
          </button>
          <button
            type="button"
            className="setup-overlay-btn setup-overlay-reset"
            onClick={handleReset}
            disabled={!dirty}
          >
            Reset
          </button>
        </div>

        <p className="panel-hint setup-overlay-hint">
          Top safe Y = H + topOffset · LB = Block_Bottom_Extent + BO
        </p>
      </div>
    </>
  )
}

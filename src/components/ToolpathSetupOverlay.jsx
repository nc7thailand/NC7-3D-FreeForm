import React, { useEffect, useState } from 'react'
import ToolpathParametersForm from './ToolpathParametersForm'
import { useAppState } from '../context/AppState'
import { CUT_MODE_LEFT_TO_RIGHT, CUT_MODE_LEFT_ONLY } from '../lib/cutJob'

/**
 * Toolpath Setup modal — BLOCKING. Opens on the first Toolpath visit in a tab
 * session or when the user clicks the gear icon. Never auto-opens on refresh.
 * Draft-only: edits accumulate in `draftStock` + `draftCutMode` and take effect
 * only on Apply. Reset/✕/Escape discard the draft and close.
 */
export default function ToolpathSetupOverlay({ open, onClose }) {
  const {
    stock,
    cutMode,
    commitToolpathSettings,
  } = useAppState()

  const [draftStock, setDraftStock] = useState(null)
  const [draftCutMode, setDraftCutMode] = useState(cutMode)
  const [applying, setApplying] = useState(false)

  // Seed draft from applied state each time the panel opens.
  useEffect(() => {
    if (open) {
      setDraftStock({ ...stock })
      setDraftCutMode(cutMode)
    }
  }, [open, stock, cutMode])

  // Escape = Reset (discard + close). Only active while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleReset()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draftStock, draftCutMode])

  if (!open || !draftStock) return null

  const stockDirty = Object.keys(stock).some((k) => stock[k] !== draftStock[k])
  const dirty = stockDirty || draftCutMode !== cutMode

  const updateDraft = (key, value) => {
    setDraftStock((prev) => ({ ...prev, [key]: value }))
  }

  const resetDraft = () => {
    setDraftStock({ ...stock })
    setDraftCutMode(cutMode)
  }

  const handleReset = () => {
    resetDraft()
    onClose()
  }

  const handleApply = async () => {
    if (!dirty) {
      // No changes — just close, no recompute.
      onClose()
      return
    }
    setApplying(true)
    try {
      await commitToolpathSettings({ stock: draftStock, cutMode: draftCutMode })
      onClose()
    } finally {
      setApplying(false)
    }
  }

  return (
    <>
      <div className="backdrop setup-backdrop" aria-hidden />
      <div
        className="setup-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Toolpath setup"
      >
        <div className="setup-overlay-header">
          <h2>Toolpath Setup</h2>
          <button type="button" className="setup-overlay-close" onClick={handleReset} aria-label="Close setup">
            ✕
          </button>
        </div>
        <p className="setup-overlay-sub">Foam block &amp; wire offsets (Method 1)</p>

        <div className="setup-overlay-cutmethod">
          <label className="setup-overlay-cutmethod-label" htmlFor="setup-cutmode">Cut method</label>
          <select
            id="setup-cutmode"
            className="setup-overlay-select"
            value={draftCutMode}
            onChange={(e) => setDraftCutMode(e.target.value)}
          >
            <option value={CUT_MODE_LEFT_ONLY}>Left only</option>
            <option value={CUT_MODE_LEFT_TO_RIGHT}>Left → Right</option>
          </select>
        </div>

        <ToolpathParametersForm compact value={draftStock} onChange={updateDraft} />

        {dirty && (
          <p className="setup-overlay-dirty">Unsaved changes — click Apply to apply</p>
        )}

        <div className="setup-overlay-actions">
          <button
            type="button"
            className="setup-overlay-btn setup-overlay-apply"
            onClick={handleApply}
            disabled={applying}
          >
            {applying ? 'Applying…' : 'Apply'}
          </button>
          <button
            type="button"
            className="setup-overlay-btn setup-overlay-reset"
            onClick={handleReset}
            disabled={applying}
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

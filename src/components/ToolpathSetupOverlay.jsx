import React from 'react'
import ToolpathParametersForm from './ToolpathParametersForm'

export default function ToolpathSetupOverlay({ open, onClose }) {
  if (!open) return null

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
        <ToolpathParametersForm compact />
        <p className="panel-hint setup-overlay-hint">
          Top safe Y = H + topOffset · LB = Block_Bottom_Extent + BO
        </p>
      </div>
    </>
  )
}

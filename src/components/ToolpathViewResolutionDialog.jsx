import React from 'react'
import CenteredModalOverlay from './CenteredModalOverlay'

export default function ToolpathViewResolutionDialog({
  open,
  remember,
  onRememberChange,
  onChoose,
}) {
  return (
    <CenteredModalOverlay
      open={open}
      title="3D view resolution"
      ariaLabel="3D view resolution"
      panelClassName="centered-overlay-panel--resolution"
      onClose={() => {}}
    >
      <p className="import-dialog-body import-dialog-body--lead">
        Only hi-resolution model is used for toolpath calculation. What model resolution do you want to see in the 3D view?
      </p>
      <p className="import-dialog-body">
        <strong>Hi-resolution.</strong> Good for hi-spec PCs but may slow down and crash on low-spec PCs. No harm — just refresh the page.
      </p>
      <p className="import-dialog-body">
        <strong>Low-resolution.</strong> Good for low-spec PCs but the model will look different. Does not affect toolpath or precision.
      </p>
      <p className="import-dialog-body">
        You can change this anytime by clicking the Hi / Lo button in the left HUD.
      </p>
      <label className="import-dialog-remember">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => onRememberChange(e.target.checked)}
        />
        Remember my decision
      </label>
      <div className="import-dialog-actions import-dialog-actions--split">
        <button
          type="button"
          className="import-dialog-primary"
          onClick={() => onChoose('hi')}
        >
          Hi-Resolution
        </button>
        <button
          type="button"
          className="import-dialog-secondary"
          onClick={() => onChoose('lo')}
        >
          Low-Resolution
        </button>
      </div>
    </CenteredModalOverlay>
  )
}

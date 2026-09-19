import React from 'react'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '../routes'
import { useAppState } from '../context/AppState'
import ToolpathSetupOverlay from './ToolpathSetupOverlay'

function ToolpathNavCenter({ onOpenSetup }) {
  const {
    rotationN,
    setRotationN,
    cutCount,
    cutIndex,
    setCutIndex,
    thetaDeg,
    simActive,
    setSimActive,
    simPlaying,
    setSimPlaying,
  } = useAppState()

  const clampN = (n) => Math.min(64, Math.max(3, n))

  return (
    <div className="page-nav-center header-cut-controls">
      <button
        type="button"
        className="setup-gear-btn"
        onClick={onOpenSetup}
        aria-label="Toolpath setup"
        title="Toolpath setup"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
          <path
            fill="currentColor"
            d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97 0-.33-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1 0 .33.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.66Z"
          />
        </svg>
      </button>
      <label className="header-n-label">
        N
        <input
          type="number"
          min="3"
          max="64"
          className="header-n-input"
          value={rotationN}
          onChange={(e) => setRotationN(clampN(+e.target.value || 16))}
        />
      </label>
      <button
        type="button"
        className="cut-nav-btn"
        disabled={cutIndex <= 0}
        onClick={() => setCutIndex((i) => Math.max(0, i - 1))}
        aria-label="Previous cut"
      >
        ◀
      </button>
      <span className="header-cut-readout">
        {cutIndex + 1}/{cutCount} · {thetaDeg.toFixed(1)}°
      </span>
      <button
        type="button"
        className="cut-nav-btn"
        disabled={cutIndex >= cutCount - 1}
        onClick={() => setCutIndex((i) => Math.min(cutCount - 1, i + 1))}
        aria-label="Next cut"
      >
        ▶
      </button>
      <button
        type="button"
        className={`cut-nav-btn sim-toggle-btn${simActive ? ' is-active' : ''}`}
        onClick={() => setSimActive((v) => !v)}
        aria-pressed={simActive}
        aria-label="Toggle Sim"
        title="Sim"
      >
        Sim
      </button>
      <button
        type="button"
        className={`cut-nav-btn sim-play-btn${simPlaying ? ' is-active' : ''}`}
        disabled={!simActive}
        onClick={() => setSimPlaying((v) => !v)}
        aria-pressed={simPlaying}
        aria-label="Play wire animation"
        title="Play"
      >
        {simPlaying ? 'Pause' : 'Play'}
      </button>
    </div>
  )
}

export default function PageNav({ page }) {
  const navigate = useNavigate()
  const { hasModel, hasToolpath, saveModelStage, saveToolpathStage, toolpathSetupOpen, openToolpathSetup, closeToolpathSetup } = useAppState()

  const config = {
    model: {
      back: null,
      backLabel: null,
      next: ROUTES.toolpath,
      nextLabel: 'Next → Toolpath',
      nextDisabled: !hasModel,
    },
    toolpath: {
      back: ROUTES.model,
      backLabel: '← Back to Model',
      next: ROUTES.simulate,
      nextLabel: 'Next → Simulate',
      nextDisabled: !hasToolpath,
    },
    simulate: {
      back: ROUTES.toolpath,
      backLabel: '← Back to Toolpath',
      next: ROUTES.gcode,
      nextLabel: 'Next → G-code',
      nextDisabled: false,
    },
    gcode: {
      back: ROUTES.simulate,
      backLabel: '← Back to Simulate',
      next: null,
      nextLabel: null,
      nextDisabled: true,
    },
  }[page]

  if (!config) return null

  const goNext = async () => {
    if (page === 'model' && !(await saveModelStage())) return
    if (page === 'toolpath' && !(await saveToolpathStage())) return
    if (config.next) navigate(config.next)
  }

  return (
    <>
      {page === 'toolpath' && (
        <ToolpathSetupOverlay open={toolpathSetupOpen} onClose={closeToolpathSetup} />
      )}
      <footer className={`page-nav${page === 'toolpath' ? ' page-nav--toolpath' : ''}`}>
        <div className="page-nav-inner">
          {config.back ? (
            <button type="button" className="nav-btn nav-back" onClick={() => navigate(config.back)}>
              {config.backLabel}
            </button>
          ) : (
            <span className="nav-spacer" />
          )}
          {page === 'toolpath' && (
            <ToolpathNavCenter onOpenSetup={openToolpathSetup} />
          )}
          {config.next ? (
            <button
              type="button"
              className="nav-btn nav-next"
              disabled={config.nextDisabled}
              onClick={goNext}
            >
              {config.nextLabel}
            </button>
          ) : (
            <span className="nav-spacer" />
          )}
        </div>
      </footer>
    </>
  )
}

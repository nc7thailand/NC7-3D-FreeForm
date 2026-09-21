import React from 'react'

/**
 * Floating wire simulator bar (WSB) — ported from the Pathfinder reference.
 *
 * Two rows, bottom-centre of the 2D panel:
 *   Row 1: gear · stop · play/pause · reset · status badge · speed slider
 *   Row 2: progress % · distance · time · scrub slider
 *
 * Presentational only: every value and callback arrives via props, so the
 * animation state stays owned by one place (AppState + SilhouettePreviewPanel).
 * Class names use the `wsb-` prefix — the reference's `sim-` names would
 * collide with the existing 2D panel's classes.
 *
 * The gear button is an addition to the Pathfinder layout: it opens the
 * Simulation & G-code panel.
 */
export default function WireSimulatorBar({
  status,
  playing,
  distanceMM,
  lengthMM,
  jobDistanceMM = null,
  jobLengthMM = null,
  pct,
  elapsedLabel,
  totalLabel,
  speedMultiplier,
  scrubMax = 1000,
  cutReadout = null,
  onGear,
  onStop,
  onTogglePlay,
  onReset,
  onSpeedChange,
  onScrub,
}) {
  const displayDistance = jobDistanceMM ?? distanceMM
  const displayLength = jobLengthMM ?? lengthMM
  const scrubDistance = jobLengthMM != null && jobLengthMM > 0
    ? (jobDistanceMM ?? 0)
    : distanceMM
  const scrubLength = jobLengthMM != null && jobLengthMM > 0
    ? jobLengthMM
    : lengthMM
  const scrubValue = scrubLength > 0
    ? Math.round(Math.min(1, Math.max(0, scrubDistance / scrubLength)) * scrubMax)
    : 0

  return (
    <div className="wsb-bar">
      {/* Row 1 — controls + speed */}
      <div className="wsb-row">
        <div className="wsb-row-left">
          <button
            type="button"
            className="wsb-btn wsb-gear-btn"
            onClick={onGear}
            title="Simulation & G-code settings"
            aria-label="Simulation and G-code settings"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19.14 12.94a7.5 7.5 0 0 0 .06-.94 7.5 7.5 0 0 0-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.62l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.1 7.1 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.75 8.86a.5.5 0 0 0 .12.62l2.03 1.58a7.5 7.5 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.62l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.62l-2.03-1.58ZM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2Z"
              />
            </svg>
          </button>

          <button
            type="button"
            className="wsb-btn wsb-stop-btn"
            onClick={onStop}
            title="Stop &amp; exit simulation"
            aria-label="Stop and exit simulation"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" />
            </svg>
          </button>

          <button
            type="button"
            className="wsb-btn wsb-play-btn"
            onClick={onTogglePlay}
            title="Play / pause simulation"
            aria-label={playing ? 'Pause simulation' : 'Play simulation'}
            aria-pressed={playing}
          >
            {playing ? (
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path fill="currentColor" d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <button
            type="button"
            className="wsb-btn wsb-reset-btn"
            onClick={onReset}
            title="Reset to start"
            aria-label="Reset to start"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"
              />
            </svg>
          </button>

          <div className="wsb-status-group">
            <div className={`wsb-badge${status === 'CUTTING' ? ' is-cutting' : ''}`}>
              {status}
            </div>
            {cutReadout && (
              <span className="wsb-cut-readout">Cut {cutReadout}</span>
            )}
          </div>
        </div>

        <div className="wsb-row-right wsb-row-speed">
          <div className="wsb-label-tag">
            <span className="wsb-speed-label">
              Speed: <strong>{speedMultiplier}x</strong>
            </span>
          </div>
          <div className="wsb-slider-wrap">
            <input
              type="range"
              className="wsb-speed-slider"
              min="1"
              max="100"
              step="1"
              value={speedMultiplier}
              onChange={(e) => onSpeedChange(+e.target.value)}
              title="Simulation speed (1x - 100x)"
              aria-label="Simulation speed multiplier"
            />
          </div>
        </div>
      </div>

      {/* Row 2 — metrics + scrub */}
      <div className="wsb-row">
        <div className="wsb-row-left wsb-metrics">
          <span className="wsb-metric-pct">{pct}</span>
          <span className="wsb-metric-detail">
            {displayDistance.toFixed(1)} / {displayLength.toFixed(1)} mm
          </span>
          <span className="wsb-metric-detail">{elapsedLabel} / {totalLabel}</span>
        </div>

        <div className="wsb-row-right wsb-row-scrub">
          <div className="wsb-label-tag">
            <span className="wsb-scrub-label">Progress</span>
          </div>
          <div className="wsb-slider-wrap">
            <input
              type="range"
              className="wsb-scrub-slider"
              min="0"
              max={scrubMax}
              step="1"
              value={scrubValue}
              onChange={(e) => onScrub(+e.target.value)}
              title="Simulation progress scrub"
              aria-label="Simulation progress"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

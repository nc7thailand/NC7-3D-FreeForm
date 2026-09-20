import React, { useEffect, useState } from 'react'
import { useAppState } from '../context/AppState'
import {
  SIM_FEED_RATE_UNITS,
  SIM_FEED_RATE_DEFAULT,
  feedRateForDisplay,
  feedRateToCanonical,
} from '../lib/simSettings'

/**
 * Simulation & G-code settings panel (SGP) — opened by the gear button in the
 * wire simulator bar.
 *
 * Draft-only, like the Toolpath Setup overlay: edits accumulate locally and are
 * committed on Apply. Writes go to the SIMULATOR's own feed rate, never to
 * `gcodeSettings.feedRate` — that one belongs to the G-code emitter and must
 * not be reachable from a playback control.
 */
export default function SimulationGcodePanel({ open, onClose }) {
  const { simSettings, updateSimSettings } = useAppState()

  const [draftRate, setDraftRate] = useState(SIM_FEED_RATE_DEFAULT)
  const [draftUnit, setDraftUnit] = useState('mm/min')
  const [moreOpen, setMoreOpen] = useState(false)

  // Seed the draft from the applied settings each time the panel opens, and
  // present the value in the stored display unit.
  useEffect(() => {
    if (!open) return
    setDraftUnit(simSettings.simFeedRateUnit)
    setDraftRate(
      Number(feedRateForDisplay(simSettings.simFeedRate, simSettings.simFeedRateUnit).toFixed(3)),
    )
    setMoreOpen(false)
  }, [open, simSettings.simFeedRate, simSettings.simFeedRateUnit])

  // Escape closes without committing, matching the setup overlay's behaviour.
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
    const rate = Number(draftRate)
    // Canonical storage is mm/min regardless of the display unit.
    const canonical = Number.isFinite(rate) && rate > 0
      ? feedRateToCanonical(rate, draftUnit)
      : SIM_FEED_RATE_DEFAULT
    updateSimSettings({ simFeedRate: canonical, simFeedRateUnit: draftUnit })
    onClose()
  }

  const unitLabel = draftUnit === 'inches/min' ? 'in/min' : 'mm/min'

  return (
    <>
      <div className="backdrop setup-backdrop wsb-sgp-backdrop" aria-hidden onClick={onClose} />
      <div
        className="wsb-sgp"
        role="dialog"
        aria-modal="true"
        aria-label="Simulation and G-code settings"
      >
        <div className="wsb-sgp-header">
          <h2>Simulation &amp; G-code</h2>
          <button type="button" className="wsb-sgp-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="wsb-sgp-field">
          <label htmlFor="wsb-sgp-feed">Feed rate</label>
          <input
            id="wsb-sgp-feed"
            type="number"
            min="0"
            step={draftUnit === 'inches/min' ? 1 : 10}
            value={draftRate}
            onChange={(e) => setDraftRate(e.target.value)}
          />
          <select
            className="wsb-sgp-unit"
            value={draftUnit}
            onChange={(e) => {
              // Convert the shown number so the underlying rate is preserved
              // when the user switches units.
              const prevUnit = draftUnit
              const nextUnit = e.target.value
              const n = Number(draftRate)
              if (Number.isFinite(n) && n > 0) {
                const canonical = feedRateToCanonical(n, prevUnit)
                setDraftRate(Number(feedRateForDisplay(canonical, nextUnit).toFixed(3)))
              }
              setDraftUnit(nextUnit)
            }}
            aria-label="Feed rate unit"
          >
            {SIM_FEED_RATE_UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className="wsb-sgp-expander"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
        >
          <span className={`wsb-sgp-caret${moreOpen ? ' is-open' : ''}`}>▼</span>
          Open for more options…
        </button>
        {moreOpen && (
          <div className="wsb-sgp-more">
            {/* Reserved for future simulation options. */}
            <p className="wsb-sgp-hint">No further options yet.</p>
          </div>
        )}

        <p className="wsb-sgp-note">
          Simulation only — this feed rate does not affect exported G-code.
          Displayed as {unitLabel}.
        </p>

        <div className="wsb-sgp-actions">
          <button type="button" className="wsb-sgp-btn wsb-sgp-apply" onClick={handleApply}>
            Apply
          </button>
          <button type="button" className="wsb-sgp-btn wsb-sgp-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </>
  )
}

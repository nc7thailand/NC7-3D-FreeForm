import React, { useEffect, useMemo, useState } from 'react'
import SmartNumberInput from '../components/SmartNumberInput'
import PageNav from '../components/PageNav'
import { useAppState } from '../context/AppState'
import {
  generateGcode,
  downloadGcode,
  defaultGcodeFilename,
  POST_PROCESS_OPTIONS,
  POST_PROCESS_GRBL,
  ROTARY_AXIS_OPTIONS,
} from '../lib/gcode'
import { topSafeY } from '../lib/wirePath'
import { effectiveBottomSafeOffset } from '../lib/toolpath'

function gcodeSettingsEqual(a, b) {
  return a.feedRate === b.feedRate
    && a.indexFeed === b.indexFeed
    && a.spindle === b.spindle
    && a.rotaryAxis === b.rotaryAxis
    && (a.postProcess ?? POST_PROCESS_GRBL) === (b.postProcess ?? POST_PROCESS_GRBL)
}

export default function GcodePage() {
  const { cutJob, stock, geometry, modelName, gcodeSettings, setGcodeSettings } = useAppState()
  const [draftSettings, setDraftSettings] = useState(gcodeSettings)
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    setDraftSettings(gcodeSettings)
  }, [gcodeSettings])

  const { feedRate, indexFeed, spindle, rotaryAxis, postProcess } = draftSettings

  const jobStock = cutJob?.stock ?? stock
  const profileCount = cutJob?.cuts?.filter((c) => c.profile.polylines.length > 0).length ?? 0
  const lb0 = effectiveBottomSafeOffset(0, jobStock)
  const dirty = !gcodeSettingsEqual(draftSettings, gcodeSettings)

  const gcodeResult = useMemo(() => {
    if (!cutJob) return null
    return generateGcode(cutJob, gcodeSettings, { geometry })
  }, [cutJob, gcodeSettings, geometry])

  const updateDraft = (key, value) => {
    setDraftSettings((prev) => ({ ...prev, [key]: value }))
  }

  const handleApply = () => {
    setGcodeSettings({ ...draftSettings })
  }

  const handleDownload = () => {
    if (!gcodeResult?.program) return
    downloadGcode(
      gcodeResult.program,
      defaultGcodeFilename(modelName, postProcess ?? POST_PROCESS_GRBL),
    )
  }

  return (
    <main className="page-main">
      <div className="page-body">
        <div className="gcode-page">
          <div className="section-label">Page 3 — G-code Generation</div>

          {!cutJob ? (
            <div className="placeholder-content">
              <p className="placeholder-note">No saved cut job — go back to Toolpath and press Next to commit the toolpath.</p>
            </div>
          ) : (
            <div className={`gcode-layout${previewOpen ? '' : ' gcode-layout--preview-hidden'}`}>
              <aside className="gcode-settings">
                <h3>Method 1 · G1</h3>
                <div className="inputs">
                  <label>Cut feed (mm/min)
                    <SmartNumberInput min={1} step={10} emptyFallback={700} value={feedRate} onChange={(n) => updateDraft('feedRate', n)} />
                  </label>
                  <label>Rotary Axis Notation
                    <select
                      className="gcode-axis-select"
                      value={rotaryAxis ?? 'Z'}
                      onChange={(e) => updateDraft('rotaryAxis', e.target.value)}
                    >
                      {ROTARY_AXIS_OPTIONS.map((axis) => (
                        <option key={axis} value={axis}>{axis}</option>
                      ))}
                    </select>
                  </label>
                  <label>Rotary axis speed (mm/min)
                    <SmartNumberInput min={1} step={1} emptyFallback={160} value={indexFeed} onChange={(n) => updateDraft('indexFeed', n)} />
                  </label>
                  <label>Spindle (S)
                    <SmartNumberInput min={0} step={100} emptyFallback={1000} value={spindle} onChange={(n) => updateDraft('spindle', n)} />
                  </label>
                  <label>Post process
                    <select
                      className="gcode-axis-select"
                      value={postProcess ?? POST_PROCESS_GRBL}
                      onChange={(e) => updateDraft('postProcess', e.target.value)}
                    >
                      {POST_PROCESS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="gcode-job-summary">
                  <h3>Job</h3>
                  <ul>
                    <li><strong>{cutJob.cutCount ?? cutJob.cuts.length}</strong> cuts (N={cutJob.rotationN}, half-span 0–180°)</li>
                    <li><strong>{profileCount}</strong> with profile</li>
                    <li>Stock {jobStock.w}×{jobStock.t}×{jobStock.h} mm</li>
                    <li>Kerf {jobStock.kerf ?? 2} mm · LO {jobStock.lo}</li>
                    <li>Top safe Y = {topSafeY(jobStock).toFixed(1)} mm</li>
                    <li>
                      Bottom safe LB = {lb0.toFixed(1)} mm
                      {jobStock.boAuto !== false ? ' (auto)' : ` (BO ${jobStock.bo})`}
                    </li>
                    {gcodeResult && (
                      <li><strong>{gcodeResult.lineCount}</strong> G-code lines</li>
                    )}
                  </ul>
                </div>

                <div className="gcode-actions">
                  <button
                    type="button"
                    className="header-next-btn"
                    onClick={handleApply}
                    disabled={!dirty}
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    className="header-next-btn"
                    onClick={handleDownload}
                    disabled={!gcodeResult?.cutCount}
                  >
                    Download
                  </button>
                  <button
                    type="button"
                    className={`cut-nav-btn gcode-preview-toggle${previewOpen ? ' is-active' : ''}`}
                    onClick={() => setPreviewOpen((open) => !open)}
                    disabled={!gcodeResult?.cutCount}
                    aria-expanded={previewOpen}
                  >
                    G code preview
                  </button>
                </div>
              </aside>

              {previewOpen && (
                <section className="gcode-preview-panel">
                  <div className="section-label section-label-sub">G code Preview</div>
                  <textarea
                    className="gcode-preview"
                    readOnly
                    spellCheck={false}
                    value={gcodeResult?.program ?? ''}
                  />
                </section>
              )}
            </div>
          )}
        </div>
      </div>
      <PageNav page="gcode" />
    </main>
  )
}

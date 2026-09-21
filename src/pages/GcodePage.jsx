import React, { useMemo } from 'react'
import PageNav from '../components/PageNav'
import { useAppState } from '../context/AppState'
import { generateGcode, downloadGcode, defaultGcodeFilename } from '../lib/gcode'
import { topSafeY } from '../lib/wirePath'
import { effectiveBottomSafeOffset, resolveBo } from '../lib/toolpath'

export default function GcodePage() {
  const { cutJob, stock, modelName, gcodeSettings, geometry, handleGcodeSettingsChange } = useAppState()
  const { feedRate, indexFeed, spindle } = gcodeSettings

  const jobStock = cutJob?.stock ?? stock
  const profileCount = cutJob?.cuts?.filter((c) => c.profile.polylines.length > 0).length ?? 0
  const lb0 = effectiveBottomSafeOffset(0, jobStock, geometry)

  const gcodeResult = useMemo(() => {
    if (!cutJob) return null
    return generateGcode(cutJob, gcodeSettings)
  }, [cutJob, gcodeSettings])

  const handleDownload = () => {
    if (!gcodeResult?.program) return
    downloadGcode(gcodeResult.program, defaultGcodeFilename(modelName))
  }

  const handleCopy = async () => {
    if (!gcodeResult?.program) return
    try {
      await navigator.clipboard.writeText(gcodeResult.program)
    } catch {
      /* clipboard may be unavailable */
    }
  }

  return (
    <main className="page-main">
      <div className="page-body">
        <div className="gcode-page">
          <div className="section-label">Page 4 — G-code Generation</div>

          {!cutJob ? (
            <div className="placeholder-content">
              <p className="placeholder-note">No saved cut job — go back to Page 2 and press Next to commit the toolpath.</p>
            </div>
          ) : (
            <div className="gcode-layout">
              <aside className="gcode-settings">
                <h3>Method 1 · G93</h3>
                <div className="inputs">
                  <label>Cut feed (mm/min)
                    <input type="number" min="1" step="10" value={feedRate} onChange={(e) => handleGcodeSettingsChange('feedRate', +e.target.value || 700)} />
                  </label>
                  <label>Z index feed (G93 F)
                    <input type="number" min="1" step="1" value={indexFeed} onChange={(e) => handleGcodeSettingsChange('indexFeed', +e.target.value || 160)} />
                  </label>
                  <label>Spindle (S)
                    <input type="number" min="0" step="100" value={spindle} onChange={(e) => handleGcodeSettingsChange('spindle', +e.target.value || 1000)} />
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
                      {jobStock.boAuto !== false ? ' (auto)' : ` (BO ${resolveBo(jobStock, geometry).toFixed(1)})`}
                    </li>
                    {gcodeResult && (
                      <li><strong>{gcodeResult.lineCount}</strong> G-code lines</li>
                    )}
                  </ul>
                </div>

                <div className="gcode-actions">
                  <button type="button" className="header-next-btn" onClick={handleDownload} disabled={!gcodeResult?.cutCount}>
                    Download .nc
                  </button>
                  <button type="button" className="cut-nav-btn" onClick={handleCopy} disabled={!gcodeResult?.cutCount}>
                    Copy
                  </button>
                </div>
              </aside>

              <section className="gcode-preview-panel">
                <div className="section-label section-label-sub">Program preview</div>
                <textarea
                  className="gcode-preview"
                  readOnly
                  spellCheck={false}
                  value={gcodeResult?.program ?? ''}
                />
              </section>
            </div>
          )}
        </div>
      </div>
      <PageNav page="gcode" />
    </main>
  )
}

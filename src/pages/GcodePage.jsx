import React, { useEffect, useState } from 'react'
import SmartNumberInput from '../components/SmartNumberInput'
import PageNav from '../components/PageNav'
import { useAppState } from '../context/AppState'
import { compileGcodeInWorker } from '../lib/camWorkerClient'
import GCodePreviewModal from '../components/GCodePreviewModal'
import {
  downloadGcode,
  defaultGcodeFilename,
  INDEX_MOTION_G0,
  INDEX_MOTION_G1,
  POST_PROCESS_OPTIONS,
  POST_PROCESS_GRBL,
  ROTARY_AXIS_OPTIONS,
} from '../lib/gcode'
import { topSafeY } from '../lib/wirePath'
import { effectiveBottomSafeOffset } from '../lib/toolpath'

const GCODE_COMPILE_DEBOUNCE_MS = 200

export default function GcodePage() {
  const { cutJob, stock, geometry, modelName, gcodeSettings, setGcodeSettings } = useAppState()
  const [preview3dOpen, setPreview3dOpen] = useState(false)

  const { feedRate, indexFeed, spindle, rotaryAxis, postProcess } = gcodeSettings
  const indexMotion = gcodeSettings.indexMotion ?? INDEX_MOTION_G0

  const jobStock = cutJob?.stock ?? stock
  const profileCount = cutJob?.cuts?.filter((c) => c.profile.polylines.length > 0).length ?? 0
  const lb0 = effectiveBottomSafeOffset(0, jobStock)

  const [gcodeResult, setGcodeResult] = useState(null)
  const [gcodeCompiling, setGcodeCompiling] = useState(false)

  useEffect(() => {
    if (!cutJob) {
      setGcodeResult(null)
      return undefined
    }
    let cancelled = false
    setGcodeCompiling(true)
    // Each compile copies the mesh into a worker message; debounce so typing
    // in a settings field does not stack up several full copies at once.
    const timer = setTimeout(() => {
      compileGcodeInWorker(cutJob, gcodeSettings, geometry)
        .then((result) => {
          if (!cancelled) setGcodeResult(result)
        })
        .catch(() => {
          if (!cancelled) setGcodeResult(null)
        })
        .finally(() => {
          if (!cancelled) setGcodeCompiling(false)
        })
    }, GCODE_COMPILE_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [cutJob, gcodeSettings, geometry])

  const updateSetting = (key, value) => {
    setGcodeSettings((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }))
  }

  const handleDownload = () => {
    if (!gcodeResult?.program) return
    downloadGcode(
      gcodeResult.program,
      defaultGcodeFilename(modelName, postProcess ?? POST_PROCESS_GRBL),
    )
  }

  const handleIndexMotionChange = (value) => {
    setGcodeSettings((prev) => ({
      ...prev,
      indexMotion: value,
      ...(value === INDEX_MOTION_G1 ? { indexFeed: prev.feedRate } : {}),
    }))
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
            <div className="gcode-layout gcode-layout--preview-hidden">
              <aside className="gcode-settings">
                <h3>Method 1 · G1</h3>
                <div className="inputs">
                  <label>Cut feed (mm/min)
                    <SmartNumberInput min={1} step={10} emptyFallback={700} debounceMs={300} value={feedRate} onChange={(n) => updateSetting('feedRate', n)} />
                  </label>
                  <label>Rotary Axis Notation
                    <select
                      className="gcode-axis-select"
                      value={rotaryAxis ?? 'Z'}
                      onChange={(e) => updateSetting('rotaryAxis', e.target.value)}
                    >
                      {ROTARY_AXIS_OPTIONS.map((axis) => (
                        <option key={axis} value={axis}>{axis}</option>
                      ))}
                    </select>
                  </label>
                  <label>Rotary axis speed
                    <select
                      id="RotarySpeed"
                      className="gcode-axis-select"
                      value={indexMotion}
                      onChange={(e) => handleIndexMotionChange(e.target.value)}
                    >
                      <option value={INDEX_MOTION_G0}>G0</option>
                      <option value={INDEX_MOTION_G1}>G1</option>
                    </select>
                  </label>
                  {indexMotion === INDEX_MOTION_G1 && (
                    <label>Feed rate
                      <SmartNumberInput min={1} step={10} emptyFallback={feedRate} debounceMs={300} value={indexFeed} onChange={(n) => updateSetting('indexFeed', n)} />
                    </label>
                  )}
                  <label>Spindle (S)
                    <SmartNumberInput min={0} step={100} emptyFallback={1000} debounceMs={300} value={spindle} onChange={(n) => updateSetting('spindle', n)} />
                  </label>
                  <label>Post process
                    <select
                      className="gcode-axis-select"
                      value={postProcess ?? POST_PROCESS_GRBL}
                      onChange={(e) => updateSetting('postProcess', e.target.value)}
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
                    {gcodeCompiling && (
                      <li>Compiling G-code…</li>
                    )}
                    {gcodeResult && !gcodeCompiling && (
                      <li><strong>{gcodeResult.lineCount}</strong> G-code lines</li>
                    )}
                  </ul>
                </div>

                <div className="gcode-actions">
                  <button
                    type="button"
                    className="header-next-btn"
                    onClick={() => setPreview3dOpen(true)}
                    disabled={!cutJob?.cuts?.length}
                  >
                    Preview G-code
                  </button>
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>
      <PageNav page="gcode" />
      <GCodePreviewModal
        open={preview3dOpen}
        onClose={() => setPreview3dOpen(false)}
        cutJob={cutJob}
        geometry={geometry}
        rotaryAxis={rotaryAxis ?? 'Z'}
        program={gcodeCompiling ? null : gcodeResult?.program ?? null}
        onDownload={handleDownload}
      />
    </main>
  )
}

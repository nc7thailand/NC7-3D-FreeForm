import React, { lazy, Suspense, useMemo, useState, useEffect, useCallback } from 'react'
import SilhouettePreviewPanel from '../components/SilhouettePreviewPanel'
import SimulationGcodePanel from '../components/SimulationGcodePanel'
import WireSimulatorBar from '../components/WireSimulatorBar'
import PageNav from '../components/PageNav'
import ProjectPanel from '../components/ProjectPanel'
import ToolpathParametersForm from '../components/ToolpathParametersForm'
import { useAppState } from '../context/AppState'
import { useSimPlayback } from '../hooks/useSimPlayback'
import { wirePathFromProfile } from '../lib/wirePath'
import {
  loadToolpathViewMode,
  markToolpathAutoSetupShown,
  saveToolpathViewMode,
  shouldAutoOpenToolpathSetup,
} from '../lib/navigationLoad'

// Toolpath only — defer WebGL + Three viewer until Combined view is chosen.
const Viewer3D = lazy(() => import('../components/Viewer3D'))

function Viewport3DLoading() {
  return (
    <div className="viewport-3d-loading" role="status" aria-live="polite">
      <div className="loading-spinner" aria-hidden="true" />
      <span>Loading 3D view…</span>
    </div>
  )
}

function ToolpathPanel() {
  const {
    menuOpen,
    setMenuOpen,
    stock,
    rotationN,
    setRotationN,
    cutCount,
    cutIndex,
    setCutIndexManual,
    thetaDeg,
    profile,
    cutJob,
    applyToolpathSettings,
  } = useAppState()

  const wirePointCount = useMemo(() => {
    if (!profile?.polylines?.length) return null
    return wirePathFromProfile(profile, stock, thetaDeg).length
  }, [profile, stock, thetaDeg])

  const stepDeg = rotationN >= 1 ? 360 / rotationN : 0
  const clampN = (n) => Math.min(64, Math.max(3, n))

  return (
    <>
      {menuOpen && <div className="backdrop" onClick={() => setMenuOpen(false)} />}
      <aside className={`control-panel${menuOpen ? ' open' : ''}`}>
        <button
          className="panel-close"
          type="button"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        >
          ✕
        </button>

        <section className="panel panel-toolpath">
          <h2>Rotation Cuts</h2>
          <div className="inputs">
            <label>Number of cuts (N)
              <input
                type="number"
                min="3"
                max="64"
                value={rotationN}
                onChange={(e) => setRotationN(clampN(+e.target.value || 16))}
              />
            </label>
          </div>
          <p className="panel-hint">Range 3–64 · default 16 · starts at 0°</p>
          <p className="panel-hint">Step: {stepDeg.toFixed(2)}° · {cutCount} cuts (half-span, 0–180°)</p>
          <button
            type="button"
            className="apply-toolpath"
            onClick={() => applyToolpathSettings()}
          >
            Apply
          </button>
          {cutJob && (
            <p className="profile-stats">Saved job: {cutJob.rotationN} cuts in memory</p>
          )}
        </section>

        <section className="panel panel-toolpath">
          <h2>Preview Cut</h2>
          <div className="cut-nav">
            <button
              type="button"
              className="cut-nav-btn"
              disabled={cutIndex <= 0}
              onClick={() => setCutIndexManual((i) => Math.max(0, i - 1))}
            >
              ◀
            </button>
            <span className="cut-nav-readout">
              Cut {cutIndex + 1} / {cutCount} · θ = {thetaDeg.toFixed(1)}°
            </span>
            <button
              type="button"
              className="cut-nav-btn"
              disabled={cutIndex >= cutCount - 1}
              onClick={() => setCutIndexManual((i) => Math.min(cutCount - 1, i + 1))}
            >
              ▶
            </button>
          </div>
          {profile && (
            <p className="profile-stats">
              silhouette {profile.pointCount} pts
              {wirePointCount != null && <> · wire {wirePointCount} pts</>}
            </p>
          )}
        </section>

        <section className="panel panel-toolpath">
          <h2>Foam Block</h2>
          <ToolpathParametersForm />
        </section>

        <ProjectPanel />
      </aside>
    </>
  )
}

export default function ToolpathPage() {
  const {
    geometry,
    resetKey,
    status,
    stock,
    thetaDeg,
    profile,
    silhouettePreview,
    viewerRef,
    stats,
    rotationN,
    cutCount,
    cutIndex,
    cutMode,
    openToolpathSetup,
    simActive,
    simPlaying,
    setSimPlaying,
    setSimActive,
    simSettings,
    updateSimSettings,
    simPanelOpen,
    openSimPanel,
    closeSimPanel,
    gcodeSettings,
    sessionReady,
  } = useAppState()

  const playback = useSimPlayback({
    enabled: simActive,
    geometry,
    stock,
    cutMode,
    rotationN,
    cutIndex,
    thetaDeg,
    simPlaying,
    setSimPlaying,
    simSettings,
    gcodeSettings,
  })

  // View mode: '2d' (default) — canvas only, no WebGL. 'combined' lazy-loads
  // Viewer3D with the 2D overlay on the fixed wire plane.
  const [viewMode, setViewMode] = useState(loadToolpathViewMode)

  useEffect(() => {
    saveToolpathViewMode(viewMode)
  }, [viewMode])

  // Auto-open Toolpath Setup only on the first Toolpath visit in a tab session
  // (never on refresh — reload restores committed state without forcing the panel).
  useEffect(() => {
    if (!sessionReady) return
    if (!shouldAutoOpenToolpathSetup()) return
    markToolpathAutoSetupShown()
    openToolpathSetup()
  }, [sessionReady, openToolpathSetup])

  const wirePointCount = useMemo(() => {
    if (!profile?.polylines?.length) return null
    return wirePathFromProfile(profile, stock, thetaDeg).length
  }, [profile, stock, thetaDeg])

  const isCombined = viewMode === 'combined'
  const show2d = viewMode === '2d'
  const show3d = viewMode !== '2d'

  const mmss = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
    const total = Math.round(seconds)
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  const wireSpeed = playback.wireFeedRate / 60
  const simTimeElapsed = mmss(wireSpeed > 0 ? playback.simGlobalDistance / wireSpeed : 0)
  const simTimeTotal = mmss(wireSpeed > 0 ? playback.jobTotalMM / wireSpeed : 0)
  const simPct = playback.jobTotalMM > 0
    ? `${((playback.simGlobalDistance / playback.jobTotalMM) * 100).toFixed(1)}%`
    : '0.0%'
  const simStatus = useMemo(() => {
    if (playback.jobTotalMM <= 0) return 'READY'
    if (!simPlaying && playback.simGlobalDistance >= playback.jobTotalMM - 1e-3) return 'DONE'
    if (playback.phase === 'indexing') {
      if (playback.indexSubPhase === 'pre-k') return 'INDEX → K'
      if (playback.indexSubPhase === 'post-k') return 'INDEX → K'
      if (playback.indexSubPhase === 'post-i') return 'INDEX → I'
      if (playback.indexSubPhase === 'approach-green') return 'INDEX → START'
      if (playback.indexSubPhase === 'lo-to-k') return 'INDEX → K'
      return playback.colliding ? 'COLLISION' : 'INDEXING'
    }
    if (simPlaying) return playback.colliding ? 'COLLISION' : 'CUTTING'
    return playback.simGlobalDistance > 0 ? 'PAUSED' : 'READY'
  }, [playback, simPlaying])

  const handleScrub = useCallback(async (value) => {
    if (!(playback.jobTotalMM > 0)) return
    await playback.seekToGlobal((value / 1000) * playback.jobTotalMM)
  }, [playback])

  const handleSpeedChange = useCallback((mult) => {
    updateSimSettings?.({ simSpeedMultiplier: Math.min(100, Math.max(1, Math.round(mult))) })
  }, [updateSimSettings])

  return (
    <>
      <ToolpathPanel />

      <main className="page-main page-main--toolpath">
        <div className="page-body">
          <div className={`cam-split cam-split--mode-${viewMode}`}>
            <div className="mobile-view-toggle" role="tablist" aria-label="View toggle">
              <button
                type="button"
                role="tab"
                aria-selected={show2d}
                className={`mobile-view-toggle-btn${show2d ? ' is-active' : ''}`}
                onClick={() => setViewMode('2d')}
              >
                2D
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={isCombined}
                className={`mobile-view-toggle-btn${isCombined ? ' is-active' : ''}`}
                onClick={() => setViewMode('combined')}
              >
                Combined
              </button>
            </div>
            {show2d && (
              <SilhouettePreviewPanel
                geometry={geometry}
                thetaDeg={thetaDeg}
                cutIndex={cutIndex}
                cutMode={cutMode}
                stock={stock}
                simActive={simActive}
                playback={simActive ? playback : null}
                rotationN={rotationN}
                onOpenSimPanel={openSimPanel}
              />
            )}
            {show3d && (
              <section className="model-viewport-section">
                <Suspense fallback={<Viewport3DLoading />}>
                  <Viewer3D
                    ref={viewerRef}
                    geometry={geometry}
                    resetKey={resetKey}
                    thetaDeg={simActive ? playback.displayThetaDeg : thetaDeg}
                    cutIndex={cutIndex}
                    stock={stock}
                    profile={profile}
                    silhouettePreview={silhouettePreview}
                    cutMode={cutMode}
                    readOnly
                    showToolpathOverlay
                    showModelBBox={false}
                    combinedView={isCombined}
                    simActive={simActive}
                    simPlayback={simActive ? playback : null}
                    rotationN={rotationN}
                  />
                </Suspense>
              </section>
            )}
          </div>
          {status && !status.startsWith('Session restored') && !status.startsWith('Model saved') && (
            <div className="status-bar status-bar--above-nav">{status}</div>
          )}
          {stats && (
            <div className="stats-inline">
              <span>θ = {thetaDeg.toFixed(1)}° · {cutCount}/{rotationN} cuts</span>
              {wirePointCount != null && (
                <span>wire {wirePointCount} pts</span>
              )}
              <span>{stats.sizeMM.x.toFixed(0)}×{stats.sizeMM.y.toFixed(0)}×{stats.sizeMM.z.toFixed(0)} mm</span>
            </div>
          )}
        </div>
        {simActive && (
          <WireSimulatorBar
            status={simStatus}
            playing={simPlaying}
            distanceMM={playback.simDistance}
            lengthMM={playback.wireLengthMM}
            jobDistanceMM={playback.simGlobalDistance}
            jobLengthMM={playback.jobTotalMM}
            pct={simPct}
            elapsedLabel={simTimeElapsed}
            totalLabel={simTimeTotal}
            speedMultiplier={simSettings?.simSpeedMultiplier ?? 10}
            cutReadout={`${cutIndex + 1}/${playback.cutCount}`}
            onGear={openSimPanel}
            onStop={() => {
              playback.handleStop()
              setSimActive(false)
            }}
            onTogglePlay={playback.handleTogglePlay}
            onReset={playback.handleReset}
            onSpeedChange={handleSpeedChange}
            onScrub={handleScrub}
          />
        )}
        <PageNav page="toolpath" />
      </main>

      <SimulationGcodePanel open={simPanelOpen} onClose={closeSimPanel} />
    </>
  )
}

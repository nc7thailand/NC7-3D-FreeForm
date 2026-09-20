import React, { useMemo, useState, useEffect } from 'react'
import Viewer3D from '../components/Viewer3D'
import SilhouettePreviewPanel from '../components/SilhouettePreviewPanel'
import SimulationGcodePanel from '../components/SimulationGcodePanel'
import PageNav from '../components/PageNav'
import ProjectPanel from '../components/ProjectPanel'
import ToolpathParametersForm from '../components/ToolpathParametersForm'
import { useAppState } from '../context/AppState'
import { wirePathFromProfile } from '../lib/wirePath'

function ToolpathPanel() {
  const {
    menuOpen,
    setMenuOpen,
    stock,
    rotationN,
    setRotationN,
    cutCount,
    cutIndex,
    setCutIndex,
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
              onClick={() => setCutIndex((i) => Math.max(0, i - 1))}
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
              onClick={() => setCutIndex((i) => Math.min(cutCount - 1, i + 1))}
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
  } = useAppState()

  // View mode: 'combined' shows the 3D viewport with the 2D cut drawing
  // overlaid on the fixed wire plane; '2d' keeps its existing behaviour.
  // The plain 3D view is not offered on this page — Combined supersedes it.
  // Combined is the default.
  const [viewMode, setViewMode] = useState('combined')

  // Open the blocking Toolpath Setup panel on every entry to this page.
  useEffect(() => {
    openToolpathSetup()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const wirePointCount = useMemo(() => {
    if (!profile?.polylines?.length) return null
    return wirePathFromProfile(profile, stock, thetaDeg).length
  }, [profile, stock, thetaDeg])

  const isCombined = viewMode === 'combined'
  const show2d = viewMode === '2d'
  const show3d = viewMode !== '2d'

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
                simPlaying={simPlaying}
                setSimPlaying={setSimPlaying}
                rotationN={rotationN}
                simSettings={simSettings}
                updateSimSettings={updateSimSettings}
                onOpenSimPanel={openSimPanel}
                onStopSim={() => setSimActive(false)}
              />
            )}
            {show3d && (
              <section className="model-viewport-section">
                <Viewer3D
                  ref={viewerRef}
                  geometry={geometry}
                  resetKey={resetKey}
                  thetaDeg={thetaDeg}
                  cutIndex={cutIndex}
                  stock={stock}
                  profile={profile}
                  silhouettePreview={silhouettePreview}
                  cutMode={cutMode}
                  readOnly
                  showToolpathOverlay
                  showModelBBox={false}
                  combinedView={isCombined}
                />
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
        <PageNav page="toolpath" />
      </main>

      {/* Simulation & G-code settings, opened by the gear in the simulator bar. */}
      <SimulationGcodePanel open={simPanelOpen} onClose={closeSimPanel} />
    </>
  )
}

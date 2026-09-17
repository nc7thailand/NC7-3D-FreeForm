import React, { useMemo, useState } from 'react'
import Viewer3D from '../components/Viewer3D'
import SilhouettePreviewPanel from '../components/SilhouettePreviewPanel'
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
    cutMode,
    setCutMode,
  } = useAppState()

  // Mobile view: only one of {2D, 3D} is shown at a time (default 3D).
  const [mobileView, setMobileView] = useState('3d')

  const wirePointCount = useMemo(() => {
    if (!profile?.polylines?.length) return null
    return wirePathFromProfile(profile, stock, thetaDeg).length
  }, [profile, stock, thetaDeg])

  return (
    <>
      <ToolpathPanel />

      <main className="page-main page-main--toolpath">
        <div className="page-body">
          <div className={`cam-split${mobileView === '2d' ? ' cam-split--mobile-2d' : ' cam-split--mobile-3d'}`}>
            <div className="mobile-view-toggle" role="tablist" aria-label="View toggle">
              <button
                type="button"
                role="tab"
                aria-selected={mobileView === '2d'}
                className={`mobile-view-toggle-btn${mobileView === '2d' ? ' is-active' : ''}`}
                onClick={() => setMobileView('2d')}
              >
                2D
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mobileView === '3d'}
                className={`mobile-view-toggle-btn${mobileView === '3d' ? ' is-active' : ''}`}
                onClick={() => setMobileView('3d')}
              >
                3D
              </button>
            </div>
            <SilhouettePreviewPanel
              geometry={geometry}
              thetaDeg={thetaDeg}
              cutMode={cutMode}
              setCutMode={setCutMode}
              stock={stock}
            />
            <section className="model-viewport-section">
              <Viewer3D
                ref={viewerRef}
                geometry={geometry}
                resetKey={resetKey}
                thetaDeg={thetaDeg}
                stock={stock}
                profile={profile}
                silhouettePreview={silhouettePreview}
                cutMode={cutMode}
                readOnly
                showToolpathOverlay
                showModelBBox={stock.showModelBBox !== false}
              />
            </section>
          </div>
          {status && !status.startsWith('Session restored') && (
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
    </>
  )
}

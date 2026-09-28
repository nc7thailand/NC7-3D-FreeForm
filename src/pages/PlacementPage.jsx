import React from 'react'
import Viewer3D from '../components/Viewer3D'
import PageNav from '../components/PageNav'
import { useAppState } from '../context/AppState'

function PlacementPanel() {
  const {
    menuOpen,
    setMenuOpen,
    sceneObjects,
    selectedObjectId,
    toolpathObjectId,
    handleSelectObject,
    handleAddHelper,
    handleSettle,
    handleCenter,
  } = useAppState()

  const artworkParts = sceneObjects.filter((o) => !o.parentId)
  const helpers = sceneObjects.filter((o) => o.parentId === (toolpathObjectId ?? selectedObjectId))

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

        <section className="panel">
          <h2>Selected Object</h2>
          <p className="panel-hint">Choose the artwork part to place and cut.</p>
          <div className="split-object-list">
            {artworkParts.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`split-object-btn${o.id === (toolpathObjectId ?? selectedObjectId) ? ' is-selected' : ''}`}
                onClick={() => handleSelectObject(o.id, true)}
              >
                <span className="split-color-swatch" style={{ background: o.color }} />
                {o.name}
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Transform</h2>
          <button type="button" onClick={handleSettle}>Settle</button>
          <button type="button" onClick={handleCenter}>Center</button>
        </section>

        <section className="panel">
          <h2>Helpers</h2>
          <p className="panel-hint">Base and bridge helpers are included in the cut silhouette.</p>
          <button type="button" onClick={() => handleAddHelper('plate')}>Add Base Plate</button>
          <button type="button" onClick={() => handleAddHelper('bar')}>Add Bridge Bar</button>
          <button type="button" onClick={() => handleAddHelper('cylinder')}>Add Cylinder</button>
          {helpers.length > 0 && (
            <ul className="helper-list">
              {helpers.map((h) => (
                <li key={h.id}>
                  <span className="split-color-swatch" style={{ background: h.color }} />
                  {h.name}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </>
  )
}

export default function PlacementPage() {
  const {
    geometry,
    sceneObjects,
    selectedObjectId,
    toolpathObjectId,
    resetKey,
    status,
    viewerRef,
    stock,
    handleSettle,
    handleReset,
    handleCenter,
  } = useAppState()

  const focusId = toolpathObjectId ?? selectedObjectId

  return (
    <>
      <PlacementPanel />

      <main className="page-main">
        <div className="page-body">
          <div className="section-label">Object Placement — rotate, center, settle, add helpers</div>
          <div className="model-viewport-full">
            <Viewer3D
              ref={viewerRef}
              geometry={geometry}
              sceneObjects={sceneObjects}
              selectedObjectId={focusId}
              ghostOthers
              resetKey={resetKey}
              showModelBBox={stock.showModelBBox !== false}
              onSettle={handleSettle}
              onReset={handleReset}
              onCenter={handleCenter}
            />
          </div>
          {status && <div className="status-bar status-bar--above-nav">{status}</div>}
        </div>
        <PageNav page="placement" />
      </main>
    </>
  )
}

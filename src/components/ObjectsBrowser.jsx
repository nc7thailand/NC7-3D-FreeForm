import React from 'react'
import { useAppState } from '../context/AppState'

/**
 * Objects browser + toolpath target picker (P6).
 * Shared on Model and Placement pages.
 */
export default function ObjectsBrowser({ showToolpathTarget = true }) {
  const {
    sceneObjects,
    selectedObjectId,
    toolpathObjectId,
    handleSelectObject,
    handleSetToolpathObject,
  } = useAppState()

  if (!sceneObjects.length) return null

  const artwork = sceneObjects.filter((o) => !o.parentId)
  const helpersFor = (parentId) => sceneObjects.filter((o) => o.parentId === parentId)

  return (
    <div className="objects-browser">
      {artwork.map((obj) => (
        <div key={obj.id} className="objects-browser-group">
          <div className="objects-browser-row">
            <button
              type="button"
              className={`split-object-btn${obj.id === selectedObjectId ? ' is-selected' : ''}`}
              onClick={() => handleSelectObject(obj.id)}
            >
              <span className="split-color-swatch" style={{ background: obj.color }} />
              <span className="objects-browser-name">{obj.name}</span>
              <span className="objects-browser-type">{obj.type}</span>
            </button>
            {showToolpathTarget && (
              <button
                type="button"
                className={`toolpath-target-btn${obj.id === toolpathObjectId ? ' is-target' : ''}`}
                title="Set as toolpath target"
                onClick={() => handleSetToolpathObject(obj.id)}
              >
                {obj.id === toolpathObjectId ? '● Cut' : '○ Cut'}
              </button>
            )}
          </div>
          {helpersFor(obj.id).map((h) => (
            <div key={h.id} className="objects-browser-row objects-browser-row--helper">
              <button
                type="button"
                className={`split-object-btn${h.id === selectedObjectId ? ' is-selected' : ''}`}
                onClick={() => handleSelectObject(h.id)}
              >
                <span className="split-color-swatch" style={{ background: h.color }} />
                <span className="objects-browser-name">{h.name}</span>
                <span className="objects-browser-type">{h.type}</span>
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

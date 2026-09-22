import React, { useCallback, useEffect } from 'react'
import { useAppState } from '../context/AppState'
import { measureModelBlockOffset } from '../lib/modelBlockOffset'
import { CUT_MODE_LEFT_ONLY, CUT_MODE_LEFT_TO_RIGHT } from '../lib/cutJob'

const PROFILE_ACCURACY_MAX = 10

/**
 * DevFoam-style toolpath parameters (foam block + wire offsets).
 *
 * Grouped layout: Foam block → Toolpath. Setup overlay passes cutMode props;
 * sidebar omits cut method. Profile accuracy + auto bottom safe are hidden
 * (fixed to max / on).
 */
export default function ToolpathParametersForm({
  compact = false,
  value,
  onChange,
  cutMode,
  onCutModeChange,
}) {
  const { stock, handleStockChange, geometry, applyModelBlockOffsetFromStock } = useAppState()
  const s = value ?? stock
  const change = onChange ?? handleStockChange
  const offsetType = s.modelOffsetType ?? 'bottom'

  useEffect(() => {
    if ((s.profileAccuracy ?? 5) !== PROFILE_ACCURACY_MAX) {
      change('profileAccuracy', PROFILE_ACCURACY_MAX)
    }
    if (s.boAuto === false) {
      change('boAuto', true)
    }
  }, [s.profileAccuracy, s.boAuto, change])

  const handleOffsetTypeChange = useCallback((nextType) => {
    change('modelOffsetType', nextType)
    if (geometry) {
      const measured = measureModelBlockOffset(geometry, s, nextType)
      change('modelOffsetMm', +measured.toFixed(2))
    }
  }, [change, geometry, s])

  return (
    <div className={`toolpath-params${compact ? ' toolpath-params--compact' : ''}`}>
      <section className="param-group">
        <h3 className="param-group-header">Foam block</h3>

        <div className="stock-dim-row">
          <label>Width (W)
            <input type="number" min="1" value={s.w} onChange={(e) => change('w', +e.target.value)} />
          </label>
          <label>Thickness (T)
            <input type="number" min="1" value={s.t} onChange={(e) => change('t', +e.target.value)} />
          </label>
          <label>Height (H)
            <input type="number" min="1" value={s.h} onChange={(e) => change('h', +e.target.value)} />
          </label>
        </div>

        <p className="param-row-label">Model position in foam block</p>
        <div className="model-offset-block">
          <div className="model-offset-row">
            <select
              id="offsetType"
              value={offsetType}
              onChange={(e) => handleOffsetTypeChange(e.target.value)}
              aria-label="Model offset anchor"
            >
              <option value="top">top</option>
              <option value="bottom">bottom</option>
            </select>
            <input
              id="offsetDis"
              type="number"
              step="0.1"
              value={s.modelOffsetMm ?? 0}
              onChange={(e) => change('modelOffsetMm', +e.target.value)}
              aria-label="Model offset distance"
            />
            <button
              type="button"
              className="model-offset-move"
              disabled={!geometry}
              onClick={() => applyModelBlockOffsetFromStock(s)}
            >
              Move
            </button>
          </div>
          <p className="panel-hint model-offset-hint">
            {offsetType === 'top'
              ? 'Gap from model top to block top (H)'
              : 'Distance from block floor to model bottom'}
            {' · Move = preview · Apply = move + recompute cuts'}
          </p>
        </div>

        <label>BO (above model bottom)
          <input
            type="number"
            min="0"
            step="0.5"
            value={s.bo}
            onChange={(e) => change('bo', +e.target.value)}
          />
          <span className="field-hint">Cut line = model bottom + BO</span>
        </label>
      </section>

      <section className="param-group">
        <h3 className="param-group-header">Toolpath</h3>

        {onCutModeChange && cutMode != null && (
          <label className="param-cutmethod">
            Cut method
            <select
              id="setup-cutmode"
              className="setup-overlay-select"
              value={cutMode}
              onChange={(e) => onCutModeChange(e.target.value)}
            >
              <option value={CUT_MODE_LEFT_ONLY}>Left only</option>
              <option value={CUT_MODE_LEFT_TO_RIGHT}>Left → Right</option>
            </select>
          </label>
        )}

        <label>LO (wire clearance)
          <input type="number" min="0" step="0.5" value={s.lo} onChange={(e) => change('lo', +e.target.value)} />
        </label>
        <label>Kerf (wire Ø comp.)
          <input type="number" min="0" step="0.1" value={s.kerf ?? 2} onChange={(e) => change('kerf', +e.target.value)} />
        </label>
        <label>Top safe offset
          <input type="number" min="0" step="1" value={s.topOffset ?? 20} onChange={(e) => change('topOffset', +e.target.value)} />
        </label>
        <label>Bottom safe point offset (mm)
          <input
            type="number"
            min="0"
            step="1"
            value={s.boMargin ?? 20}
            onChange={(e) => change('boMargin', +e.target.value)}
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={s.showModelBBox !== false}
            onChange={(e) => change('showModelBBox', e.target.checked)}
          />
          Show model bounding box
        </label>
        <label>Overlay thickness
          <input
            type="number"
            min="1"
            max="10"
            step="1"
            value={s.overlayThickness ?? 3}
            onChange={(e) => change('overlayThickness', +e.target.value)}
          />
        </label>

        <div className="param-field-hidden" aria-hidden="true">
          <label>Profile accuracy (1–10)
            <input
              type="range"
              min="1"
              max="10"
              step="1"
              value={PROFILE_ACCURACY_MAX}
              readOnly
              tabIndex={-1}
            />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked readOnly tabIndex={-1} />
            Auto bottom safe (hypot/2 + margin)
          </label>
        </div>

        {!compact && (
          <p className="panel-hint">Top safe Y = H + topOffset · Kerf shifts wire path left</p>
        )}
      </section>
    </div>
  )
}

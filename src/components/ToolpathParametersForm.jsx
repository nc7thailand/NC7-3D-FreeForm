import React, { useCallback, useEffect } from 'react'
import { useAppState } from '../context/AppState'
import { measureModelBlockOffset } from '../lib/modelBlockOffset'
import { CUT_MODE_LEFT_ONLY, CUT_MODE_LEFT_TO_RIGHT } from '../lib/cutJob'
import SmartNumberInput from './SmartNumberInput'

const PROFILE_ACCURACY_MAX = 10

function ParamField({ label, unit, children, className = '' }) {
  return (
    <div className={`param-field${className ? ` ${className}` : ''}`}>
      <span className="param-field-label">{label}</span>
      <div className="param-field-control">
        {children}
        {unit ? <span className="param-field-unit">{unit}</span> : null}
      </div>
    </div>
  )
}

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
            <SmartNumberInput min={1} emptyFallback={1} debounceMs={300} value={s.w} onChange={(n) => change('w', n)} />
          </label>
          <label>Thickness (T)
            <SmartNumberInput min={1} emptyFallback={1} debounceMs={300} value={s.t} onChange={(n) => change('t', n)} />
          </label>
          <label>Height (H)
            <SmartNumberInput min={1} emptyFallback={1} debounceMs={300} value={s.h} onChange={(n) => change('h', n)} />
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
            <SmartNumberInput
              id="offsetDis"
              step={0.1}
              debounceMs={300}
              value={s.modelOffsetMm ?? 0}
              onChange={(n) => change('modelOffsetMm', n)}
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
      </section>

      <section className="param-group">
        <h3 className="param-group-header">Toolpath</h3>

        <div className="param-fields">
          <ParamField label="Model Bottom Cut Out" unit="mm">
            <SmartNumberInput min={0} step={0.5} debounceMs={300} value={s.bo} onChange={(n) => change('bo', n)} />
          </ParamField>

          {onCutModeChange && cutMode != null && (
            <ParamField label="Cut method">
              <select
                id="setup-cutmode"
                className="param-field-select"
                value={cutMode}
                onChange={(e) => onCutModeChange(e.target.value)}
              >
                <option value={CUT_MODE_LEFT_ONLY}>Left only</option>
                <option value={CUT_MODE_LEFT_TO_RIGHT}>Left → Right</option>
              </select>
            </ParamField>
          )}

          <ParamField label="LO (wire clearance)" unit="mm">
            <SmartNumberInput min={0} step={0.5} debounceMs={300} value={s.lo} onChange={(n) => change('lo', n)} />
          </ParamField>

          <ParamField label="Kerf (wire Ø comp.)" unit="mm">
            <SmartNumberInput min={0} step={0.1} debounceMs={300} value={s.kerf ?? 2} onChange={(n) => change('kerf', n)} />
          </ParamField>

          <ParamField label="Top safe offset" unit="mm">
            <SmartNumberInput min={0} step={1} debounceMs={300} value={s.topOffset ?? 20} onChange={(n) => change('topOffset', n)} />
          </ParamField>

          <ParamField label="Bottom safe point offset" unit="mm">
            <SmartNumberInput min={0} step={1} debounceMs={300} value={s.boMargin ?? 20} onChange={(n) => change('boMargin', n)} />
          </ParamField>

          <ParamField label="Overlay thickness">
            <SmartNumberInput min={1} max={10} step={1} emptyFallback={1} debounceMs={300} value={s.overlayThickness ?? 3} onChange={(n) => change('overlayThickness', n)} />
          </ParamField>

          <label className="param-field param-field--checkbox">
            <span className="param-field-label">Show model bounding box</span>
            <input
              type="checkbox"
              checked={s.showModelBBox !== false}
              onChange={(e) => change('showModelBBox', e.target.checked)}
            />
          </label>
        </div>

        <div className="param-field-hidden" aria-hidden="true">
          <label>Profile accuracy (1–10)
            <input type="range" min="1" max="10" step="1" value={PROFILE_ACCURACY_MAX} readOnly tabIndex={-1} />
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

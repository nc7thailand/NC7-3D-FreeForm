import React, { useCallback } from 'react'
import { useAppState } from '../context/AppState'
import { measureModelBlockOffset } from '../lib/modelBlockOffset'

/**
 * DevFoam-style toolpath parameters (foam block + wire offsets).
 *
 * Controlled component: renders from `value` and reports changes through
 * `onChange(key, value)`. When `value`/`onChange` are omitted it falls back to
 * the live AppState stock + handleStockChange (used by the sidebar form).
 */
export default function ToolpathParametersForm({
  compact = false,
  value,
  onChange,
}) {
  const { stock, handleStockChange, geometry } = useAppState()
  const s = value ?? stock
  const change = onChange ?? handleStockChange
  const offsetType = s.modelOffsetType ?? 'bottom'

  const handleOffsetTypeChange = useCallback((nextType) => {
    change('modelOffsetType', nextType)
    if (geometry) {
      const measured = measureModelBlockOffset(geometry, s, nextType)
      change('modelOffsetMm', +measured.toFixed(2))
    }
  }, [change, geometry, s])

  return (
    <div className={`inputs${compact ? ' inputs--compact' : ''}`}>
      <label>Width (W)
        <input type="number" min="1" value={s.w} onChange={(e) => change('w', +e.target.value)} />
      </label>
      <label>Thickness (T)
        <input type="number" min="1" value={s.t} onChange={(e) => change('t', +e.target.value)} />
      </label>
      <label>Height (H)
        <input type="number" min="1" value={s.h} onChange={(e) => change('h', +e.target.value)} />
      </label>

      <div className="model-offset-block">
        <p className="model-offset-heading">Model offset from foam block</p>
        <div className="model-offset-row">
          <select
            id="offsetType"
            value={offsetType}
            onChange={(e) => handleOffsetTypeChange(e.target.value)}
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
          />
        </div>
        <p className="panel-hint model-offset-hint">
          {offsetType === 'top'
            ? 'Gap from model top to block top (H)'
            : 'Distance from block floor to model bottom'}
          {' · Apply to move model'}
        </p>
      </div>

      <label>LO (wire clearance)
        <input type="number" min="0" step="0.5" value={s.lo} onChange={(e) => change('lo', +e.target.value)} />
      </label>
      <label>BO (bottom offset)
        <input
          type="number"
          min="0"
          step="0.5"
          value={s.bo}
          disabled={s.boAuto !== false}
          onChange={(e) => change('bo', +e.target.value)}
        />
      </label>
      <label>Profile accuracy (1–10)
        <input
          type="range"
          min="1"
          max="10"
          step="1"
          value={s.profileAccuracy ?? 5}
          onChange={(e) => change('profileAccuracy', +e.target.value)}
        />
        <span className="range-readout">{s.profileAccuracy ?? 5}</span>
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
          checked={s.boAuto !== false}
          onChange={(e) => change('boAuto', e.target.checked)}
        />
        Auto bottom safe (hypot/2 + margin)
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
      {!compact && (
        <p className="panel-hint">Top safe Y = H + topOffset · Kerf shifts wire path left</p>
      )}
    </div>
  )
}

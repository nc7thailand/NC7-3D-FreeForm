import React from 'react'
import { useAppState } from '../context/AppState'

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
  const { stock, handleStockChange } = useAppState()
  const s = value ?? stock
  const change = onChange ?? handleStockChange

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

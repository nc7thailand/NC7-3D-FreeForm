import React from 'react'
import { useAppState } from '../context/AppState'

/**
 * DevFoam-style toolpath parameters (foam block + wire offsets).
 */
export default function ToolpathParametersForm({ compact = false }) {
  const { stock, handleStockChange } = useAppState()

  return (
    <div className={`inputs${compact ? ' inputs--compact' : ''}`}>
      <label>Width (W)
        <input type="number" min="1" value={stock.w} onChange={(e) => handleStockChange('w', +e.target.value)} />
      </label>
      <label>Thickness (T)
        <input type="number" min="1" value={stock.t} onChange={(e) => handleStockChange('t', +e.target.value)} />
      </label>
      <label>Height (H)
        <input type="number" min="1" value={stock.h} onChange={(e) => handleStockChange('h', +e.target.value)} />
      </label>
      <label>LO (wire clearance)
        <input type="number" min="0" step="0.5" value={stock.lo} onChange={(e) => handleStockChange('lo', +e.target.value)} />
      </label>
      <label>BO (bottom offset)
        <input
          type="number"
          min="0"
          step="0.5"
          value={stock.bo}
          disabled={stock.boAuto !== false}
          onChange={(e) => handleStockChange('bo', +e.target.value)}
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={stock.boAuto !== false}
          onChange={(e) => handleStockChange('boAuto', e.target.checked)}
        />
        Auto bottom safe (hypot/2 + margin)
      </label>
      {stock.boAuto !== false && (
        <label>Bottom safe margin (mm)
          <input
            type="number"
            min="0"
            step="1"
            value={stock.boMargin ?? 20}
            onChange={(e) => handleStockChange('boMargin', +e.target.value)}
          />
        </label>
      )}
      <label>Kerf (wire Ø comp.)
        <input type="number" min="0" step="0.1" value={stock.kerf ?? 2} onChange={(e) => handleStockChange('kerf', +e.target.value)} />
      </label>
      <label>Top safe offset
        <input type="number" min="0" step="1" value={stock.topOffset ?? 20} onChange={(e) => handleStockChange('topOffset', +e.target.value)} />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={stock.showModelBBox !== false}
          onChange={(e) => handleStockChange('showModelBBox', e.target.checked)}
        />
        Show model bounding box
      </label>
      {!compact && (
        <p className="panel-hint">Top safe Y = H + topOffset · Kerf shifts wire path left</p>
      )}
    </div>
  )
}

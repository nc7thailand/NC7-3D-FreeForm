import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppState } from '../context/AppState'
import {
  minimapCaption,
  minimapFoamBlockLayout,
  minimapFoamBlockRotationDeg,
  minimapRawNAll,
  MINIMAP_SIZE_PX,
} from '../lib/minimap2d.js'
import MinimapNAllOverlayPanel from './MinimapNAllOverlayPanel.jsx'

const MINIMAP_TOOLTIP = 'Click to edit total N count'

/**
 * Foam-block minimap — fixed 9 o'clock blue marker, rotating top-down stock
 * shape, caption below the disc.
 */
export default function Minimap2DOverlay({
  stock,
  rotationN,
  cutIndex,
  cutMode,
}) {
  const { setRotationN, saveToolpathStage } = useAppState()
  const widgetRef = useRef(null)
  const [hovered, setHovered] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [draftNAll, setDraftNAll] = useState(rotationN ?? 16)

  const caption = minimapCaption(cutIndex, rotationN, cutMode)
  const foamRotation = minimapFoamBlockRotationDeg(cutIndex, rotationN, cutMode)
  const foamLayout = useMemo(
    () => minimapFoamBlockLayout(stock),
    [stock?.w, stock?.t],
  )
  const rawNAll = minimapRawNAll(rotationN)

  useEffect(() => {
    if (panelOpen) setDraftNAll(rawNAll)
  }, [panelOpen, rawNAll])

  const openPanel = useCallback(() => {
    setDraftNAll(rawNAll)
    setPanelOpen(true)
    setHovered(false)
  }, [rawNAll])

  const closePanel = useCallback(() => {
    setPanelOpen(false)
  }, [])

  const handleApplyNAll = useCallback(async (newN) => {
    setPanelOpen(false)
    if (newN === rawNAll) return
    setRotationN(newN)
    await saveToolpathStage()
  }, [rawNAll, saveToolpathStage, setRotationN])

  const handleClick = useCallback((e) => {
    e.stopPropagation()
    openPanel()
  }, [openPanel])

  return (
    <>
      <div
        ref={widgetRef}
        className={`minimap-2d-widget${hovered ? ' is-hovered' : ''}${panelOpen ? ' is-panel-open' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={`Minimap ${caption}. ${MINIMAP_TOOLTIP}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openPanel()
          }
        }}
      >
        <div className="minimap-2d-frame" style={{ width: MINIMAP_SIZE_PX, height: MINIMAP_SIZE_PX }}>
          <div
            className="minimap-marker-9oclock"
            aria-hidden="true"
            title="Active cut (9 o'clock)"
          />

          <div
            className="minimap-foam-rotator"
            style={{ transform: `rotate(${foamRotation}deg)` }}
            aria-hidden="true"
          >
            <div
              className="minimap-foam-block"
              style={{
                width: foamLayout.widthPx,
                height: foamLayout.heightPx,
              }}
            >
              <svg
                className="minimap-foam-origin"
                viewBox="0 0 12 16"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <polygon points="0,8 12,1 12,15" fill="#1d5cff" />
              </svg>
            </div>
          </div>
        </div>

        <div className="minimap-caption-bottom" aria-live="polite">
          {caption}
        </div>

        {hovered && !panelOpen && (
          <div className="minimap-tooltip-bubble" role="tooltip">
            {MINIMAP_TOOLTIP}
          </div>
        )}
      </div>

      <MinimapNAllOverlayPanel
        open={panelOpen}
        draftValue={draftNAll}
        appliedValue={rawNAll}
        onDraftChange={setDraftNAll}
        onApply={handleApplyNAll}
        onClose={closePanel}
      />
    </>
  )
}

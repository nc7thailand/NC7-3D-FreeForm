import React, { useEffect, useRef } from 'react'
import { SAFE_ZONE } from '../lib/safeZoneManager'

const MAX_OFFSET = 9999

const CAPTION = {
  [SAFE_ZONE.TOP]: 'Model Top Offset',
  [SAFE_ZONE.BOTTOM]: 'Model Bottom Offset',
}

function clampOffset(raw) {
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n)) return null
  return Math.min(MAX_OFFSET, Math.max(0, n))
}

/**
 * Floating model-gap editor (green top / red bottom) — caption left, vertical
 * controls right, active point at anchor, Apply beside input. Transparent shell.
 */
export default function ModelGapOffsetOverlay({
  panel,
  onClose,
  onApply,
  onDraftChange,
  onNudge,
}) {
  const inputRef = useRef(null)

  useEffect(() => {
    if (!panel) return undefined
    const t = setTimeout(() => inputRef.current?.select(), 0)
    return () => clearTimeout(t)
  }, [panel?.key])

  useEffect(() => {
    if (!panel) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel, onClose])

  if (!panel) return null

  const draft = panel.draftValue ?? 0
  const inputId = `model-gap-offset-${panel.key}`
  const zoneType = panel.zoneType ?? SAFE_ZONE.TOP
  const caption = CAPTION[zoneType] ?? CAPTION[SAFE_ZONE.TOP]
  const captionClass = zoneType === SAFE_ZONE.BOTTOM
    ? 'model-gap-offset-caption model-gap-offset-caption--bottom'
    : 'model-gap-offset-caption model-gap-offset-caption--top'

  const commitDraft = () => {
    const n = clampOffset(draft)
    if (n == null) return
    if (n === panel.appliedValue) {
      onClose()
      return
    }
    onApply(n)
  }

  return (
    <div
      className="model-gap-offset-anchor"
      style={{ left: panel.sx, top: panel.sy }}
      role="presentation"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={captionClass} aria-hidden>
        {caption}
      </div>

      <div
        className="model-gap-offset-stack"
        role="dialog"
        aria-modal="false"
        aria-label={caption}
      >
        <button
          type="button"
          className="model-gap-offset-step"
          onClick={() => onNudge(5)}
          aria-label="Increase 5 mm"
        >
          +5
        </button>
        <button
          type="button"
          className="model-gap-offset-step"
          onClick={() => onNudge(1)}
          aria-label="Increase 1 mm"
        >
          +1
        </button>
        <div className="model-gap-offset-value-row">
          <input
            ref={inputRef}
            id={inputId}
            className="model-gap-offset-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            value={String(draft)}
            aria-label={`${caption} in millimeters`}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
              if (digits === '') {
                onDraftChange(0)
                return
              }
              onDraftChange(Number(digits))
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitDraft()
              }
            }}
          />
          <button
            type="button"
            className="model-gap-offset-apply"
            onClick={commitDraft}
          >
            Apply
          </button>
        </div>
        <button
          type="button"
          className="model-gap-offset-step"
          onClick={() => onNudge(-1)}
          aria-label="Decrease 1 mm"
        >
          -1
        </button>
        <button
          type="button"
          className="model-gap-offset-step"
          onClick={() => onNudge(-5)}
          aria-label="Decrease 5 mm"
        >
          -5
        </button>
      </div>
    </div>
  )
}

import React, { useEffect, useRef } from 'react'

const MAX_OFFSET = 9999

function clampOffset(raw) {
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n)) return null
  return Math.min(MAX_OFFSET, Math.max(0, n))
}

/**
 * Floating controls anchored below the active bottom safe point on the 2D
 * canvas (BO margin editor). Panel background is fully transparent.
 */
export default function BottomSafePointOffsetOverlay({
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

  const draft = panel.draftValue ?? 20
  const inputId = `bottom-safe-offset-${panel.key}`

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
      className="bottom-safe-offset-anchor"
      style={{ left: panel.sx, top: panel.sy }}
      role="presentation"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bottom-safe-offset-label" aria-hidden>
        Bottom Safe Point Offset
      </div>

      <div
        className="bottom-safe-offset-panel"
        role="dialog"
        aria-modal="false"
        aria-label="Bottom Safe Point Offset"
      >
        <div className="bottom-safe-offset-controls">
          <button
            type="button"
            className="bottom-safe-offset-step"
            onClick={() => onNudge(5)}
            aria-label="Increase 5 mm"
          >
            +5
          </button>
          <button
            type="button"
            className="bottom-safe-offset-step"
            onClick={() => onNudge(1)}
            aria-label="Increase 1 mm"
          >
            +1
          </button>
          <input
            ref={inputRef}
            id={inputId}
            className="bottom-safe-offset-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            value={String(draft)}
            aria-label="Bottom safe offset in millimeters"
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
            className="bottom-safe-offset-step"
            onClick={() => onNudge(-1)}
            aria-label="Decrease 1 mm"
          >
            -1
          </button>
          <button
            type="button"
            className="bottom-safe-offset-step"
            onClick={() => onNudge(-5)}
            aria-label="Decrease 5 mm"
          >
            -5
          </button>
        </div>
        <button
          type="button"
          className="bottom-safe-offset-apply"
          onClick={commitDraft}
        >
          Apply
        </button>
      </div>
    </div>
  )
}

import React, { useEffect, useRef } from 'react'

const MAX_OFFSET = 9999

function clampOffset(raw) {
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n)) return null
  return Math.min(MAX_OFFSET, Math.max(0, n))
}

/**
 * Floating top-offset editor — caption left, vertical controls right, active
 * point at the anchor pixel, Apply beside the input. Fully transparent shell.
 */
export default function TopSafePointOffsetOverlay({
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
  const inputId = `top-safe-offset-${panel.key}`

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
      className="top-safe-offset-anchor"
      style={{ left: panel.sx, top: panel.sy }}
      role="presentation"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="top-safe-offset-caption"
        aria-hidden
      >
        Top Safe Point Offset
      </div>

      <div
        className="top-safe-offset-stack"
        role="dialog"
        aria-modal="false"
        aria-label="Top Safe Point Offset"
      >
        <button
          type="button"
          className="top-safe-offset-step"
          onClick={() => onNudge(5)}
          aria-label="Increase 5 mm"
        >
          +5
        </button>
        <button
          type="button"
          className="top-safe-offset-step"
          onClick={() => onNudge(1)}
          aria-label="Increase 1 mm"
        >
          +1
        </button>
        <div className="top-safe-offset-value-row">
          <input
            ref={inputRef}
            id={inputId}
            className="top-safe-offset-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            value={String(draft)}
            aria-label="Top safe offset in millimeters"
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
            className="top-safe-offset-apply"
            onClick={commitDraft}
          >
            Apply
          </button>
        </div>
        <button
          type="button"
          className="top-safe-offset-step"
          onClick={() => onNudge(-1)}
          aria-label="Decrease 1 mm"
        >
          -1
        </button>
        <button
          type="button"
          className="top-safe-offset-step"
          onClick={() => onNudge(-5)}
          aria-label="Decrease 5 mm"
        >
          -5
        </button>
      </div>
    </div>
  )
}

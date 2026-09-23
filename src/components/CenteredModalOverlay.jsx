import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'

/**
 * Full-screen modal backdrop with a centered panel. Blocks interaction with
 * the rest of the app until the panel is dismissed or Apply completes.
 */
export default function CenteredModalOverlay({
  open,
  title,
  ariaLabel,
  onClose,
  children,
}) {
  useEffect(() => {
    if (!open) return undefined
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="centered-modal-backdrop"
      role="presentation"
      onPointerDown={(e) => {
        e.stopPropagation()
      }}
      onClick={(e) => {
        e.stopPropagation()
      }}
    >
      <div
        className="centered-overlay-panel"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title ?? 'Dialog'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {title ? <h2 className="centered-overlay-title">{title}</h2> : null}
        {children}
      </div>
    </div>,
    document.body,
  )
}

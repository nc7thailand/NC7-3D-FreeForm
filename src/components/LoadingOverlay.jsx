import React from 'react'

/**
 * Full-screen blocking overlay shown while a long synchronous job runs.
 *
 * `progress` is optional: pass { done, total } for jobs that can report their
 * step count, or null for work that cannot (parsing, settling, normal rebuilds).
 */
export default function LoadingOverlay({ active, message, progress }) {
  if (!active) return null

  const hasProgress = progress && progress.total > 0
  const pct = hasProgress
    ? Math.min(100, Math.round((progress.done / progress.total) * 100))
    : null

  return (
    <div className="loading-overlay" role="alert" aria-live="assertive" aria-busy="true">
      <div className="loading-card">
        <div className="loading-spinner" aria-hidden="true" />
        <p className="loading-message">{message || 'Working…'}</p>
        {hasProgress && (
          <>
            <div className="loading-bar">
              <div className="loading-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <p className="loading-count">
              {progress.done} / {progress.total}
            </p>
          </>
        )}
      </div>
    </div>
  )
}

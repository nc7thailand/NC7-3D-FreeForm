import React from 'react'

/**
 * Full-screen blocking overlay shown while a long synchronous job runs.
 *
 * `progress` is optional: pass { done, total } for jobs that can report their
 * step count, or null for work that cannot (parsing, settling, normal rebuilds).
 */
export default function LoadingOverlay({
  active,
  message,
  subMessage,
  footerMessage,
  title,
  variant,
  progress,
}) {
  if (!active) return null

  const hasProgress = progress && progress.total > 0
  const pct = hasProgress
    ? Math.min(100, Math.round((progress.done / progress.total) * 100))
    : null
  const isOptimize = variant === 'optimize'

  return (
    <div className="loading-overlay" role="alert" aria-live="assertive" aria-busy="true">
      <div className={`loading-card${isOptimize ? ' loading-card--optimize' : ''}`}>
        {!isOptimize && <div className="loading-spinner" aria-hidden="true" />}
        {title ? <h2 className="loading-title">{title}</h2> : null}
        {message ? <p className="loading-message">{message}</p> : null}
        {subMessage ? <p className="loading-submessage">{subMessage}</p> : null}
        {(hasProgress || isOptimize) && (
          <div
            className={`loading-bar${!hasProgress && isOptimize ? ' loading-bar--indeterminate' : ''}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={hasProgress ? pct : undefined}
          >
            <div
              className="loading-bar-fill"
              style={hasProgress ? { width: `${pct}%` } : undefined}
            />
          </div>
        )}
        {hasProgress && (
          <p className="loading-count">
            {progress.done} / {progress.total}
          </p>
        )}
        {footerMessage ? <p className="loading-footer">{footerMessage}</p> : null}
      </div>
    </div>
  )
}

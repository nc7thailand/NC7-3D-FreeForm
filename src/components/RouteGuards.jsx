import React from 'react'
import { Navigate } from 'react-router-dom'
import { ROUTES } from '../routes'
import { useAppState } from '../context/AppState'

function SessionLoading() {
  return (
    <div className="session-loading" role="status" aria-live="polite">
      Restoring session…
    </div>
  )
}

export function RequireModel({ children }) {
  const { hasModel, sessionReady } = useAppState()
  if (!sessionReady) return <SessionLoading />
  if (!hasModel) return <Navigate to={ROUTES.model} replace />
  return children
}

export function RequireToolpath({ children }) {
  const { hasModel, hasToolpathSaved, sessionReady } = useAppState()
  if (!sessionReady) return <SessionLoading />
  if (!hasModel) return <Navigate to={ROUTES.model} replace />
  if (!hasToolpathSaved) return <Navigate to={ROUTES.toolpath} replace />
  return children
}

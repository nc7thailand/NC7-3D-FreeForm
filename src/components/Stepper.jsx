import React from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { STEPS, ROUTES } from '../routes'
import { useAppState } from '../context/AppState'

export default function Stepper() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const {
    hasModel,
    hasToolpath,
    hasToolpathSaved,
    saveModelStage,
    refreshToolpathIfNeeded,
    ensureToolpathOnModelEntry,
  } = useAppState()

  const canVisit = (path) => {
    if (path.endsWith('/model')) return true
    if (path.endsWith('/toolpath')) return hasModel
    if (path.endsWith('/gcode')) return hasModel && hasToolpathSaved
    return false
  }

  const goTo = async (path, e) => {
    if (pathname === ROUTES.model && path === ROUTES.toolpath) {
      e.preventDefault()
      if (!(await saveModelStage())) return
      if (!(await ensureToolpathOnModelEntry())) return
      navigate(path)
      return
    }
    if (pathname === ROUTES.toolpath && path === ROUTES.gcode) {
      e.preventDefault()
      if (await refreshToolpathIfNeeded()) navigate(path)
    }
  }

  return (
    <nav className="stepper" aria-label="Workflow steps">
      {STEPS.map((step, i) => {
        const active = pathname === step.path
        const unlocked = canVisit(step.path)
        const dimmed = step.path === ROUTES.gcode && hasToolpath && !hasToolpathSaved
        return (
          <React.Fragment key={step.path}>
            {i > 0 && <span className="stepper-sep" aria-hidden="true" />}
            {unlocked ? (
              <NavLink
                to={step.path}
                className={`stepper-item${active ? ' active' : ''}`}
                onClick={(e) => goTo(step.path, e)}
              >
                <span className="stepper-num">{i + 1}</span>
                <span className="stepper-label">{step.label}</span>
              </NavLink>
            ) : (
              <span className={`stepper-item locked${active ? ' active' : ''}${dimmed ? ' dimmed' : ''}`}>
                <span className="stepper-num">{i + 1}</span>
                <span className="stepper-label">{step.label}</span>
              </span>
            )}
          </React.Fragment>
        )
      })}
    </nav>
  )
}

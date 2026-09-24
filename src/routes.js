export const ROUTES = {
  model: '/model',
  toolpath: '/toolpath',
  gcode: '/gcode',
  /** Detached from the main pipeline — route kept for legacy / experimental use. */
  simulate: '/simulate',
}

/** Main workflow steps in the header stepper (Simulate is not part of this flow). */
export const STEPS = [
  { path: ROUTES.model, label: 'Model' },
  { path: ROUTES.toolpath, label: 'Toolpath' },
  { path: ROUTES.gcode, label: 'G-code' },
]

/** Simulate page is reachable at ROUTES.simulate but excluded from STEPS. */
export const SIMULATE_ROUTE_DETACHED = true

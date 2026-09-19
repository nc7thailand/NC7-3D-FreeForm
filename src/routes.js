export const ROUTES = {
  model: '/model',
  toolpath: '/toolpath',
  gcode: '/gcode',
  simulate: '/simulate',
}

export const STEPS = [
  { path: ROUTES.model, label: 'Model' },
  { path: ROUTES.toolpath, label: 'Toolpath' },
  { path: ROUTES.simulate, label: 'Simulate' },
  { path: ROUTES.gcode, label: 'G-code' },
]

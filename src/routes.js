export const ROUTES = {
  model: '/model',
  toolpath: '/toolpath',
  gcode: '/gcode',
  simulate: '/simulate',
}

export const STEPS = [
  { path: ROUTES.model, label: 'Model', short: '1' },
  { path: ROUTES.toolpath, label: 'Toolpath', short: '2' },
  { path: ROUTES.gcode, label: 'G-code', short: '3' },
  { path: ROUTES.simulate, label: 'Simulate', short: '4' },
]

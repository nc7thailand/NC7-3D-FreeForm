// UI display mapping: show X/Y in the 2D toolpath view while internal compute
// continues to use middle-plane u/v. Values are identical — only labels differ.

export const UI_AXES_DISPLAY = {
  xAxis: 'u',
  yAxis: 'v',
  xLabel: 'X',
  yLabel: 'Y',
}

/** Display X from internal u. */
export function displayCoordX(u) {
  return u
}

/** Display Y from internal v. */
export function displayCoordY(v) {
  return v
}

/** Format one axis readout for hover bubbles and inline editors. */
export function formatAxisLine(axisKey, value) {
  const label = axisKey === UI_AXES_DISPLAY.xAxis
    ? UI_AXES_DISPLAY.xLabel
    : UI_AXES_DISPLAY.yLabel
  return `${label} = ${value.toFixed(1)} mm`
}

/** Hover/detail lines for a middle-plane point shown as X/Y. */
export function displayPointLines(u, v) {
  return [
    formatAxisLine(UI_AXES_DISPLAY.xAxis, displayCoordX(u)),
    formatAxisLine(UI_AXES_DISPLAY.yAxis, displayCoordY(v)),
  ]
}

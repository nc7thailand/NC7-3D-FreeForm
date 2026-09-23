// Origin point interaction: idle → focused → editing (2D canvas direct manipulation).

export const ORIGIN_STATE = {
  IDLE: 'idle',
  FOCUSED: 'focused',
  EDITING: 'editing',
}

export const ORIGIN_FOCUS_BUBBLE = 'Origin point. Click again to edit position.'

/** Smooth scale pulse for the focused origin gizmo (1.0 … 1.05). */
export function originPulseScale(nowSec = Date.now() / 1000, period = 1.2) {
  const phase = Math.sin((nowSec / period) * Math.PI * 2)
  return 1 + 0.05 * (0.5 + 0.5 * phase)
}

/**
 * Manages origin-point click flow on the 2D silhouette canvas.
 */
export class OriginPointManager {
  /**
   * @param {{
   *   getPosition: () => 'top'|'bottom',
   *   onApplyPosition?: (value: 'top'|'bottom') => void | Promise<void>,
   * }} options
   */
  constructor({ getPosition, onApplyPosition }) {
    this.getPosition = getPosition
    this.onApplyPosition = onApplyPosition ?? (async () => {})
    this.state = ORIGIN_STATE.IDLE
  }

  reset() {
    this.state = ORIGIN_STATE.IDLE
  }

  isFocused() {
    return this.state === ORIGIN_STATE.FOCUSED
  }

  isEditing() {
    return this.state === ORIGIN_STATE.EDITING
  }

  /**
   * @returns {'focused'|'editing'|false}
   */
  handleClick({ openPanel }) {
    if (this.state === ORIGIN_STATE.EDITING) return false

    if (this.state === ORIGIN_STATE.IDLE) {
      this.state = ORIGIN_STATE.FOCUSED
      return 'focused'
    }

    if (this.state === ORIGIN_STATE.FOCUSED) {
      this.state = ORIGIN_STATE.EDITING
      openPanel()
      return 'editing'
    }

    return false
  }

  openEditorDirect({ openPanel }) {
    this.state = ORIGIN_STATE.EDITING
    openPanel()
    return 'editing'
  }

  cancelEdit() {
    this.reset()
  }

  async applyNewPosition(value) {
    if (value !== 'top' && value !== 'bottom') {
      this.reset()
      return
    }
    await this.onApplyPosition(value)
    this.reset()
  }
}

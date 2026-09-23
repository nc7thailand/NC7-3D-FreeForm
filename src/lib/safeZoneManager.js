// Model-position zone interaction: idle → focused → editing.
// Green zone = model top vs foam block top; red zone = model bottom vs foam floor.

export const SAFE_ZONE = {
  TOP: 'top',
  BOTTOM: 'bottom',
}

export const SAFE_ZONE_STATE = {
  IDLE: 'idle',
  FOCUSED: 'focused',
  EDITING: 'editing',
}

/** @returns {'top'|'bottom'|null} */
export function safeZoneTypeFromRole(role) {
  if (role === 'top') return SAFE_ZONE.TOP
  if (role === 'bottom' || role === 'leftBottom' || role === 'rightBottom') return SAFE_ZONE.BOTTOM
  return null
}

export function safeZoneBubbleText(zoneType) {
  if (zoneType === SAFE_ZONE.TOP) {
    return 'Model gap to block top. Click again to edit.'
  }
  return 'Model gap to block floor. Click again to edit.'
}

export function safeZonePanelTitle(zoneType) {
  if (zoneType === SAFE_ZONE.TOP) return 'Model Position (Top)'
  return 'Model Position (Bottom)'
}

export function safeZoneFieldLabel(zoneType) {
  if (zoneType === SAFE_ZONE.TOP) return 'Gap from model top to block top (H)'
  return 'Gap from block floor to model bottom'
}

/**
 * Manages one safe zone (top or bottom) through idle → focused → editing.
 */
export class SafeZoneManager {
  /**
   * @param {{
   *   zoneType: 'top'|'bottom',
   *   getCurrentValue: () => number,
   *   onStateChange?: (state: string) => void,
   *   onFocused?: (ctx: object) => void,
   *   onEditing?: (ctx: object) => void,
   *   onIdle?: () => void,
   *   onApplyValue?: (value: number) => void | Promise<void>,
   * }} options
   */
  constructor({
    zoneType,
    getCurrentValue,
    onStateChange,
    onFocused,
    onEditing,
    onIdle,
    onApplyValue,
  }) {
    this.zoneType = zoneType
    this.getCurrentValue = getCurrentValue
    this.onStateChange = onStateChange ?? (() => {})
    this.onFocused = onFocused ?? (() => {})
    this.onEditing = onEditing ?? (() => {})
    this.onIdle = onIdle ?? (() => {})
    this.onApplyValue = onApplyValue ?? (async () => {})

    this.state = SAFE_ZONE_STATE.IDLE
    this.focusKey = null
    this.currentValue = getCurrentValue()
  }

  _setState(next) {
    this.state = next
    this.onStateChange(next)
  }

  reset() {
    this.focusKey = null
    if (this.state !== SAFE_ZONE_STATE.IDLE) {
      this._setState(SAFE_ZONE_STATE.IDLE)
      this.onIdle()
    }
  }

  isFocusedOn(focusKey) {
    return this.state === SAFE_ZONE_STATE.FOCUSED && this.focusKey === focusKey
  }

  isEditing() {
    return this.state === SAFE_ZONE_STATE.EDITING
  }

  /**
   * First click → focused + bubble; second click on same target → editing + panel.
   * @returns {boolean} true when the click was handled
   */
  handleClick({ focusKey, context, openPanel }) {
    if (this.state === SAFE_ZONE_STATE.EDITING) return false

    const sameTarget = this.focusKey === focusKey && this.state === SAFE_ZONE_STATE.FOCUSED

    if (this.state === SAFE_ZONE_STATE.IDLE) {
      this.focusKey = focusKey
      this.currentValue = this.getCurrentValue()
      this._setState(SAFE_ZONE_STATE.FOCUSED)
      this.onFocused(context)
      return true
    }

    if (sameTarget) {
      this._setState(SAFE_ZONE_STATE.EDITING)
      this.onEditing(context)
      openPanel()
      return true
    }

    if (this.state === SAFE_ZONE_STATE.FOCUSED) {
      this.focusKey = focusKey
      this.currentValue = this.getCurrentValue()
      this.onFocused(context)
      return true
    }

    return false
  }

  /** Desktop shortcut — skip focused and open editor immediately. */
  openEditorDirect({ focusKey, context, openPanel }) {
    this.focusKey = focusKey
    this.currentValue = this.getCurrentValue()
    this._setState(SAFE_ZONE_STATE.EDITING)
    this.onEditing(context)
    openPanel()
  }

  async applyNewValue(newValue) {
    const n = Math.max(0, Math.round(Number(newValue)))
    if (!Number.isFinite(n)) {
      this.reset()
      return
    }
    this.currentValue = n
    await this.onApplyValue(n)
    this.focusKey = null
    this._setState(SAFE_ZONE_STATE.IDLE)
    this.onIdle()
  }

  cancelEdit() {
    this.reset()
  }
}

/**
 * Routes marker clicks to the correct top/bottom manager (only one focused at a time).
 */
export class SafeZoneController {
  constructor(options) {
    this.top = new SafeZoneManager({
      zoneType: SAFE_ZONE.TOP,
      getCurrentValue: options.getTopValue,
      onApplyValue: options.onApplyTop,
      ...options.callbacks,
    })
    this.bottom = new SafeZoneManager({
      zoneType: SAFE_ZONE.BOTTOM,
      getCurrentValue: options.getBottomValue,
      onApplyValue: options.onApplyBottom,
      ...options.callbacks,
    })
  }

  managerForRole(role) {
    const zone = safeZoneTypeFromRole(role)
    if (zone === SAFE_ZONE.TOP) return this.top
    if (zone === SAFE_ZONE.BOTTOM) return this.bottom
    return null
  }

  resetAll() {
    this.top.reset()
    this.bottom.reset()
  }

  resetOther(role) {
    const active = this.managerForRole(role)
    if (active !== this.top) this.top.reset()
    if (active !== this.bottom) this.bottom.reset()
  }

  managerForZone(zoneType) {
    if (zoneType === SAFE_ZONE.TOP) return this.top
    if (zoneType === SAFE_ZONE.BOTTOM) return this.bottom
    return null
  }

  handleMarkerClick({ role, focusKey, context, openPanel }) {
    const manager = this.managerForRole(role)
    if (!manager) return false
    this.resetOther(role)
    return manager.handleClick({ focusKey, context, openPanel })
  }

  handleZoneClick({ zoneType, focusKey, context, openPanel }) {
    const manager = this.managerForZone(zoneType)
    if (!manager) return false
    const role = zoneType === SAFE_ZONE.TOP ? 'top' : 'leftBottom'
    this.resetOther(role)
    return manager.handleClick({ focusKey, context, openPanel })
  }

  openEditorDirect({ role, focusKey, context, openPanel }) {
    const manager = this.managerForRole(role)
    if (!manager) return
    this.resetOther(role)
    manager.openEditorDirect({ focusKey, context, openPanel })
  }

  openZoneEditorDirect({ zoneType, focusKey, context, openPanel }) {
    const manager = this.managerForZone(zoneType)
    if (!manager) return
    const role = zoneType === SAFE_ZONE.TOP ? 'top' : 'leftBottom'
    this.resetOther(role)
    manager.openEditorDirect({ focusKey, context, openPanel })
  }

  focusedZoneType() {
    if (this.top.state === SAFE_ZONE_STATE.FOCUSED) return SAFE_ZONE.TOP
    if (this.bottom.state === SAFE_ZONE_STATE.FOCUSED) return SAFE_ZONE.BOTTOM
    return null
  }

  isAnyFocused() {
    return this.top.state === SAFE_ZONE_STATE.FOCUSED
      || this.bottom.state === SAFE_ZONE_STATE.FOCUSED
  }
}

/** Blink opacity for the focused safe-zone highlight (matches wire marker cadence). */
export function safeZoneBlinkOpacity(nowSec = Date.now() / 1000, period = 0.55) {
  const phase = Math.sin((nowSec / period) * Math.PI * 2)
  return 0.45 + 0.55 * (0.5 + 0.5 * phase)
}

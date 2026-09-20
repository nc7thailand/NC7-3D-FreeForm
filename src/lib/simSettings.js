// Playback-only simulation preferences, persisted in localStorage.
//
// Deliberately separate from both the project manifest and `gcodeSettings`:
// these values tune the 2D preview, they are not machine output. In particular
// `simFeedRate` must never be confused with `gcodeSettings.feedRate`, which the
// G-code emitter reads — the two are decoupled on purpose.

const STORAGE_KEY = 'nc7-3dfreefoam-sim-settings'

export const SIM_FEED_RATE_DEFAULT = 500        // mm/min
export const SIM_SPEED_MULTIPLIER_DEFAULT = 10
export const SIM_FEED_RATE_UNIT_DEFAULT = 'mm/min'
export const SIM_FEED_RATE_UNITS = ['mm/min', 'inches/min']

export const SIM_SETTINGS_DEFAULTS = {
  simFeedRate: SIM_FEED_RATE_DEFAULT,
  simFeedRateUnit: SIM_FEED_RATE_UNIT_DEFAULT,
  simSpeedMultiplier: SIM_SPEED_MULTIPLIER_DEFAULT,
}

const MM_PER_INCH = 25.4

/** Canonical mm/min → the value shown for `unit`. */
export function feedRateForDisplay(mmPerMin, unit) {
  if (unit === 'inches/min') return mmPerMin / MM_PER_INCH
  return mmPerMin
}

/** A value shown in `unit` → canonical mm/min. */
export function feedRateToCanonical(value, unit) {
  if (unit === 'inches/min') return value * MM_PER_INCH
  return value
}

/**
 * Clamp/sanitise a partial record read from storage or a draft. Anything
 * unusable falls back to the default silently — a corrupt entry must never
 * stop the app from starting.
 */
export function sanitizeSimSettings(raw) {
  const out = { ...SIM_SETTINGS_DEFAULTS }
  if (!raw || typeof raw !== 'object') return out

  const feed = Number(raw.simFeedRate)
  if (Number.isFinite(feed) && feed > 0) out.simFeedRate = feed

  if (SIM_FEED_RATE_UNITS.includes(raw.simFeedRateUnit)) {
    out.simFeedRateUnit = raw.simFeedRateUnit
  }

  const mult = Math.round(Number(raw.simSpeedMultiplier))
  if (Number.isFinite(mult)) out.simSpeedMultiplier = Math.min(100, Math.max(1, mult))

  return out
}

/** Read persisted sim preferences, or defaults when absent/corrupt. */
export function loadSimSettings() {
  if (typeof window === 'undefined' || !window.localStorage) return { ...SIM_SETTINGS_DEFAULTS }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...SIM_SETTINGS_DEFAULTS }
    return sanitizeSimSettings(JSON.parse(raw))
  } catch {
    // Corrupt JSON, or storage blocked (private mode / disabled). Use defaults.
    return { ...SIM_SETTINGS_DEFAULTS }
  }
}

/** Merge `patch` over what is stored and write it back. Never throws. */
export function saveSimSettings(patch) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const merged = sanitizeSimSettings({ ...loadSimSettings(), ...patch })
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  } catch {
    // Quota exceeded or storage unavailable — playback prefs are non-critical.
  }
}

export { STORAGE_KEY as SIM_SETTINGS_STORAGE_KEY }

// NC7 hot-wire turntable — physical drive parameters for sim timing.
//
// Hardware: XL belt drive, 105-tooth / 10-tooth gear pair, 1/16 microstepping.
// Stepper: standard 1.8° (200 full steps/rev). Values are used for display
// timing only — they do not affect G-code output.

export const TURNTABLE_HARDWARE = {
  motorStepsPerRev: 200,
  microstepping: 16,
  largeGearTeeth: 105,
  smallGearTeeth: 10,
}

/** Motor steps per revolution with microstepping enabled. */
export function motorStepsPerRevWithMicrostepping() {
  const { motorStepsPerRev, microstepping } = TURNTABLE_HARDWARE
  return motorStepsPerRev * microstepping
}

/** Turntable gear ratio (large ÷ small). */
export function turntableGearRatio() {
  const { largeGearTeeth, smallGearTeeth } = TURNTABLE_HARDWARE
  return largeGearTeeth / smallGearTeeth
}

/** Turntable steps per full 360° revolution. */
export function turntableStepsPerRev() {
  return motorStepsPerRevWithMicrostepping() * turntableGearRatio()
}

/** Angular resolution of one microstep at the turntable (degrees). */
export function turntableDegPerStep() {
  return 360 / turntableStepsPerRev()
}

/**
 * Simulation speed multiplier shared by wire travel and turntable indexing.
 *
 * @param {number} [speedMultiplier=1]
 * @returns {number}
 */
export function simSpeedMultiplier(speedMultiplier = 1) {
  return Math.max(1, Number(speedMultiplier) || 1)
}

/**
 * Rotary index speed from G-code indexFeed (degrees/min on the Z axis).
 * G-code expresses rotary feed in degrees/min; the hardware gear ratio and
 * microstepping define step resolution but do not rescale the commanded rate.
 * The optional sim multiplier scales playback only (same as wire feed).
 *
 * @param {number} indexFeedDegMin
 * @param {number} [speedMultiplier=1]
 * @returns {number} degrees per second
 */
export function indexSpeedDegPerSec(indexFeedDegMin, speedMultiplier = 1) {
  const mult = simSpeedMultiplier(speedMultiplier)
  return (Math.max(0, Number(indexFeedDegMin) || 0) / 60) * mult
}

/** Turntable microsteps required for a given angle delta. */
export function indexStepsForAngle(deg) {
  return (Math.abs(Number(deg) || 0) / 360) * turntableStepsPerRev()
}

/** Implied turntable step rate (steps/s) at a given index feed. */
export function turntableStepsPerSecAtIndexFeed(indexFeedDegMin, speedMultiplier = 1) {
  const degPerSec = indexSpeedDegPerSec(indexFeedDegMin, speedMultiplier)
  return (degPerSec / 360) * turntableStepsPerRev()
}

/**
 * Wire travel speed from G-code feedRate (mm/min) with optional sim multiplier.
 *
 * @param {number} feedRateMmMin
 * @param {number} [speedMultiplier=1]
 * @returns {number} mm per second
 */
export function wireSpeedMmPerSec(feedRateMmMin, speedMultiplier = 1) {
  const mult = simSpeedMultiplier(speedMultiplier)
  return (Math.max(0, Number(feedRateMmMin) || 0) / 60) * mult
}

/**
 * Estimated real-world duration for a turntable index move.
 *
 * @param {number} fromDeg
 * @param {number} toDeg
 * @param {number} indexFeedDegMin
 * @returns {number} seconds
 */
export function indexDurationSec(fromDeg, toDeg, indexFeedDegMin, speedMultiplier = 1) {
  const delta = Math.abs(toDeg - fromDeg)
  const speed = indexSpeedDegPerSec(indexFeedDegMin, speedMultiplier)
  if (!(speed > 0) || delta < 1e-6) return 0
  return delta / speed
}

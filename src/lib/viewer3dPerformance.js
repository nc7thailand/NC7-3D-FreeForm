/**
 * Toolpath / combined 3D view policy — always hi-res mesh, no display proxy.
 * Performance comes from renderer tuning and render-on-demand when idle.
 */

export const VIEWER3D_CONFIG = {
  /** Toolpath 3D always uses the full-resolution working mesh. */
  hiResOnly: true,
  maxPixelRatio: 2,
  mobileMaxPixelRatio: 1.5,
}

/** Cap device pixel ratio so dense mobile screens stay responsive. */
export function effectivePixelRatio() {
  if (typeof window === 'undefined') return 1
  const dpr = window.devicePixelRatio || 1
  const isCoarse = window.matchMedia('(hover: none) and (pointer: coarse)').matches
  const cap = isCoarse
    ? VIEWER3D_CONFIG.mobileMaxPixelRatio
    : VIEWER3D_CONFIG.maxPixelRatio
  return Math.min(dpr, cap)
}

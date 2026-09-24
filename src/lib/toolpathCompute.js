import { cutJobHasProfile } from './cutJob.js'
import { attachIndexSafetyToJob } from './indexSafety.js'

/**
 * Phase 4 auto-compute triggers (each wired in AppState / Toolpath UI):
 *   model-entry   — Model → Toolpath navigation (return visits)
 *   setup-close   — Setup panel closed with no saved cutJob yet
 *   setup-apply   — Setup Apply with changes (commitToolpathSettings)
 *   refresh       — Toolpath mount / session restore when cutJob is stale
 *   manual-apply  — Toolpath panel Apply, Next → Simulate/G-code
 *
 * Overlay-only (no buildSectionProfile — see patchCutJob* helpers):
 *   marker-apply  — boMargin / topOffset on green/red wire markers
 *   origin-apply  — originDisplay / originU / originV (display-only)
 */
export const TOOLPATH_COMPUTE_TRIGGER = {
  MODEL_ENTRY: 'model-entry',
  SETUP_CLOSE: 'setup-close',
  SETUP_APPLY: 'setup-apply',
  REFRESH: 'refresh',
  MANUAL_APPLY: 'manual-apply',
  MARKER_APPLY: 'marker-apply',
  ORIGIN_APPLY: 'origin-apply',
}

/** Clone geometry for hi-res storage — independent of the display mesh. */
export function cloneStoredGeometry(geo) {
  if (!geo) return null
  const clone = geo.clone()
  clone.userData = { ...geo.userData }
  return clone
}

/** Bump when the hi-res model changes so a same-uuid cutJob is still detected stale. */
export function bumpModelRevision(geo) {
  if (!geo) return 0
  const next = (geo.userData.nc7ModelRevision ?? 0) + 1
  geo.userData.nc7ModelRevision = next
  return next
}

export function modelRevisionOf(geo) {
  return geo?.userData?.nc7ModelRevision ?? 0
}

/**
 * True when the buffered cutJob must be rebuilt from hi-res geometry.
 *
 * @param {object|null} job
 * @param {{
 *   rotationN: number,
 *   cutMode: string,
 *   sourceGeometryUuid?: string|null,
 *   sourceModelRevision?: number,
 * }} ctx
 */
export function cutJobNeedsRecompute(job, {
  rotationN,
  cutMode,
  sourceGeometryUuid,
  sourceModelRevision,
}) {
  if (!cutJobHasProfile(job)) return true
  if (job.rotationN !== rotationN) return true
  if ((job.mode ?? cutMode) !== cutMode) return true
  if (sourceGeometryUuid && job.sourceGeometryUuid && job.sourceGeometryUuid !== sourceGeometryUuid) {
    return true
  }
  if (
    sourceModelRevision != null
    && job.sourceModelRevision != null
    && job.sourceModelRevision !== sourceModelRevision
  ) {
    return true
  }
  if (job.cuts.some((c) => !c.overlayContour?.length)) return true
  return false
}

/**
 * Update marker-related stock on a saved cut job without re-slicing the mesh.
 * Refreshes index-safety plans (they depend on red/green marker positions).
 *
 * @param {object} job
 * @param {object} stock - merged stock snapshot
 * @param {import('three').BufferGeometry|null} geometry
 * @param {string} cutMode
 * @returns {object|null}
 */
export function patchCutJobMarkerStock(job, stock, geometry, cutMode) {
  if (!cutJobHasProfile(job)) return null
  const next = {
    ...job,
    stock: { ...stock },
    cuts: job.cuts.map((c) => ({ ...c })),
  }
  if (geometry) {
    attachIndexSafetyToJob(next, geometry, stock, cutMode)
  }
  return next
}

/**
 * Update display-only origin fields on a saved cut job (no geometry work).
 *
 * @param {object} job
 * @param {object} stock - merged stock snapshot
 * @returns {object|null}
 */
export function patchCutJobOriginStock(job, stock) {
  if (!cutJobHasProfile(job)) return null
  return { ...job, stock: { ...stock } }
}

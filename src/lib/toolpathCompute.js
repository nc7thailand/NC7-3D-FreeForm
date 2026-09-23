import { cutJobHasProfile } from './cutJob.js'

/**
 * Phase 4 auto-compute triggers (each wired in AppState / Toolpath UI):
 *   model-entry   — Model → Toolpath navigation (return visits)
 *   setup-close   — Setup panel closed with no saved cutJob yet
 *   setup-apply   — Setup Apply with changes (commitToolpathSettings)
 *   refresh       — Toolpath mount / session restore when cutJob is stale
 *   manual-apply  — Toolpath panel Apply, Next → Simulate/G-code
 */
export const TOOLPATH_COMPUTE_TRIGGER = {
  MODEL_ENTRY: 'model-entry',
  SETUP_CLOSE: 'setup-close',
  SETUP_APPLY: 'setup-apply',
  REFRESH: 'refresh',
  MANUAL_APPLY: 'manual-apply',
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

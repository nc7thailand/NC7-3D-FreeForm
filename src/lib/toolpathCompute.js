import { cutJobHasProfile } from './cutJob.js'

/** Clone geometry for hi-res storage — independent of the display mesh. */
export function cloneStoredGeometry(geo) {
  if (!geo) return null
  const clone = geo.clone()
  clone.userData = { ...geo.userData }
  return clone
}

/**
 * True when the buffered cutJob must be rebuilt from hi-res geometry.
 *
 * @param {object|null} job
 * @param {{ rotationN: number, cutMode: string, sourceGeometryUuid?: string|null }} ctx
 */
export function cutJobNeedsRecompute(job, { rotationN, cutMode, sourceGeometryUuid }) {
  if (!cutJobHasProfile(job)) return true
  if (job.rotationN !== rotationN) return true
  if ((job.mode ?? cutMode) !== cutMode) return true
  if (sourceGeometryUuid && job.sourceGeometryUuid && job.sourceGeometryUuid !== sourceGeometryUuid) {
    return true
  }
  if (job.cuts.some((c) => !c.overlayContour?.length)) return true
  return false
}

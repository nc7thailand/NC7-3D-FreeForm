import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppState } from '../context/AppState'
import { effectiveCutCount } from '../lib/cutJob'
import {
  buildSimJob,
  buildSimJobCut,
  firstPlayableCut,
  nextPlayableCut,
  pointAtDistance,
  seekGlobal,
} from '../lib/simJob'
import { indexSpeedDegPerSec, wireSpeedMmPerSec } from '../lib/turntablePhysics'
import { wireFoamCollision } from '../lib/wireCollision'

const SIM_SAMPLE_MS = 100

/**
 * Shared full-job wire simulation playback for 2D + Combined 3D views.
 * Wire speed follows gcodeSettings.feedRate; turntable index speed follows
 * gcodeSettings.indexFeed. Both scale with simSettings.simSpeedMultiplier.
 */
export function useSimPlayback({
  enabled,
  geometry,
  stock,
  cutMode,
  rotationN,
  cutIndex,
  thetaDeg,
  simPlaying,
  setSimPlaying,
  simSettings,
  gcodeSettings,
}) {
  const {
    beginBusy,
    endBusy,
    yieldToPaint,
    setBusyProgress,
    advanceSimCut,
    setCutIndexForSimStart,
    simAutoAdvanceRef,
  } = useAppState()

  const speedMultiplier = simSettings?.simSpeedMultiplier ?? 10
  const wireFeedRate = gcodeSettings?.feedRate ?? 700
  const indexFeedRate = gcodeSettings?.indexFeed ?? 160

  const cutCount = effectiveCutCount(rotationN ?? 0, { mode: cutMode })

  const simJobRef = useRef(null)
  const simJobKeyRef = useRef('')
  const completedLengthRef = useRef(0)
  const simDistRef = useRef(0)
  const simTrailRef = useRef([])
  const simLogRef = useRef([])
  const simLastSampleRef = useRef(-Infinity)
  const simSpeedRef = useRef(speedMultiplier)
  const simSeekingRef = useRef(false)
  const simRafRef = useRef(null)
  const indexTargetCutRef = useRef(-1)
  const wireAtIndexRef = useRef(null)
  const phaseRef = useRef('idle')
  const displayThetaRef = useRef(thetaDeg)
  const cutIndexRef = useRef(cutIndex)
  const prevCutIndexRef = useRef(cutIndex)
  const simPlayingRef = useRef(simPlaying)

  simSpeedRef.current = speedMultiplier
  cutIndexRef.current = cutIndex
  simPlayingRef.current = simPlaying

  const [phase, setPhase] = useState('idle')
  const [displayThetaDeg, setDisplayThetaDeg] = useState(thetaDeg)
  const [simDistance, setSimDistance] = useState(0)
  const [simGlobalDistance, setSimGlobalDistance] = useState(0)
  const [jobTotalLengthMM, setJobTotalLengthMM] = useState(0)
  const [simLabel, setSimLabel] = useState(null)
  const [simLogTick, setSimLogTick] = useState(0)
  const [colliding, setColliding] = useState(false)
  const [wireUV, setWireUV] = useState(null)
  const [trailUV, setTrailUV] = useState([])
  const [pathVersion, setPathVersion] = useState(0)

  displayThetaRef.current = displayThetaDeg
  phaseRef.current = phase

  const simJobCacheKey = useMemo(
    () => `${rotationN}|${cutMode}|${stock?.w}|${stock?.t}|${stock?.h}|${stock?.bo}|${stock?.boMargin}|${geometry?.uuid ?? ''}`,
    [rotationN, cutMode, stock?.w, stock?.t, stock?.h, stock?.bo, stock?.boMargin, geometry?.uuid],
  )

  const getCurrentCut = useCallback(() => {
    const job = simJobRef.current
    if (!job?.cuts?.length) return null
    const idx = cutIndexRef.current
    return job.cuts.find((c) => c.cutIndex === idx) ?? job.cuts[Math.min(idx, job.cuts.length - 1)]
  }, [])

  useEffect(() => {
    simJobRef.current = null
    simJobKeyRef.current = ''
    setJobTotalLengthMM(0)
  }, [simJobCacheKey])

  useEffect(() => {
    if (!enabled || !geometry) return undefined
    if (simJobRef.current && simJobKeyRef.current === simJobCacheKey) return undefined

    let cancelled = false
    ;(async () => {
      try {
        const job = await buildSimJob({ geometry, stock, cutMode, rotationN })
        if (!cancelled) {
          simJobRef.current = job
          simJobKeyRef.current = simJobCacheKey
          setJobTotalLengthMM(job.jobTotalLengthMM)
          setPathVersion((v) => v + 1)
        }
      } catch (err) {
        console.warn('[sim] background job precompute failed:', err)
      }
    })()
    return () => { cancelled = true }
  }, [enabled, geometry, stock, cutMode, rotationN, simJobCacheKey])

  // Sync turntable display angle when the user steps cuts while paused — not on
  // pause/resume, which must preserve the mid-cut / mid-index pose.
  useEffect(() => {
    if (simPlayingRef.current) return
    if (phaseRef.current === 'indexing') return
    displayThetaRef.current = thetaDeg
    setDisplayThetaDeg(thetaDeg)
  }, [thetaDeg])

  const ensureSimJob = useCallback(async () => {
    if (simJobRef.current && simJobKeyRef.current === simJobCacheKey) {
      return simJobRef.current
    }
    beginBusy('Preparing simulation…', { done: 0, total: cutCount })
    await yieldToPaint()
    try {
      const job = await buildSimJob({
        geometry,
        stock,
        cutMode,
        rotationN,
        onProgress: async (done, total) => {
          setBusyProgress(done, total)
          await yieldToPaint()
        },
      })
      simJobRef.current = job
      simJobKeyRef.current = simJobCacheKey
      setJobTotalLengthMM(job.jobTotalLengthMM)
      setPathVersion((v) => v + 1)
      return job
    } finally {
      await endBusy()
    }
  }, [
    beginBusy, cutCount, cutMode, endBusy, geometry, rotationN,
    setBusyProgress, simJobCacheKey, stock, yieldToPaint,
  ])

  const publishWireState = useCallback((pt, trail) => {
    setWireUV(pt ? { u: pt.u, v: pt.v } : null)
    setTrailUV(trail.map((p) => ({ u: p.u, v: p.v })))
  }, [])

  /** Resolve the current cut's wire path (job cache or one-off build). */
  const resolveCutWire = useCallback(() => {
    const cached = getCurrentCut()
    if (cached?.fullWirePath?.length >= 2) return cached
    if (!geometry) return null
    try {
      const count = effectiveCutCount(rotationN ?? 0, { mode: cutMode })
      const theta = count >= 1 ? (cutIndexRef.current * 360) / count : 0
      return buildSimJobCut({
        geometry,
        stock,
        cutMode,
        cutIndex: cutIndexRef.current,
        thetaDeg: theta,
      })
    } catch {
      return null
    }
  }, [geometry, stock, cutMode, rotationN, getCurrentCut])

  /** Publish wire marker at current distance (or cut start). */
  const syncWireMarkerPosition = useCallback((distOverride) => {
    if (!enabled) return
    const dist = distOverride ?? simDistRef.current

    if (phaseRef.current === 'indexing' && wireAtIndexRef.current) {
      publishWireState(wireAtIndexRef.current, simTrailRef.current)
      return
    }

    const cut = resolveCutWire()
    if (!cut?.fullWirePath?.length) return
    const pt = pointAtDistance(cut.fullWirePath, cut.wireCum, dist) ?? cut.fullWirePath[0]
    publishWireState(pt, simTrailRef.current)
  }, [enabled, publishWireState, resolveCutWire])

  useEffect(() => {
    if (!enabled) {
      phaseRef.current = 'idle'
      setPhase('idle')
      setColliding(false)
      setWireUV(null)
      setTrailUV([])
      return
    }
    syncWireMarkerPosition(0)
  }, [enabled, syncWireMarkerPosition])

  // Keep marker visible at the correct cut position when paused or idle in sim.
  useEffect(() => {
    if (!enabled || simPlaying) return
    syncWireMarkerPosition()
  }, [enabled, simPlaying, cutIndex, pathVersion, syncWireMarkerPosition])

  const resetRunState = useCallback(() => {
    simDistRef.current = 0
    simTrailRef.current = []
    simLogRef.current = []
    simLastSampleRef.current = -Infinity
    completedLengthRef.current = 0
    indexTargetCutRef.current = -1
    wireAtIndexRef.current = null
    setSimDistance(0)
    setSimGlobalDistance(0)
    setSimLabel(null)
    setSimLogTick(0)
    setColliding(false)
    publishWireState(null, [])
    phaseRef.current = 'idle'
    setPhase('idle')
  }, [publishWireState])

  useEffect(() => {
    if (!simPlaying) return undefined

    let lastFrameAt = null
    let lastLabelAt = -Infinity

    const finishJob = (label) => {
      const job = simJobRef.current
      const jobTotal = job?.jobTotalLengthMM ?? completedLengthRef.current
      setSimGlobalDistance(jobTotal)
      setSimLabel({ ...label, distance: jobTotal })
      setSimPlaying(false)
      simPlayingRef.current = false
      phaseRef.current = 'done'
      setPhase('done')
      simRafRef.current = null
    }

    const startIndexing = (nextCutIndex, endPt) => {
      const job = simJobRef.current
      const nextCut = job?.cuts?.find((c) => c.cutIndex === nextCutIndex)
      if (!nextCut) return false
      indexTargetCutRef.current = nextCutIndex
      wireAtIndexRef.current = endPt ? { u: endPt.u, v: endPt.v } : wireAtIndexRef.current
      phaseRef.current = 'indexing'
      setPhase('indexing')
      setColliding(false)
      simTrailRef.current = []
      publishWireState(wireAtIndexRef.current, [])
      return true
    }

    const step = (now) => {
      if (!simPlayingRef.current) {
        simRafRef.current = null
        return
      }

      if (lastFrameAt == null) lastFrameAt = now
      const dt = Math.max(0, (now - lastFrameAt) / 1000)
      lastFrameAt = now

      const speedMult = simSpeedRef.current
      const wireSpeed = wireSpeedMmPerSec(wireFeedRate, speedMult)
      const indexSpeed = indexSpeedDegPerSec(indexFeedRate, speedMult)

      if (phaseRef.current === 'indexing') {
        const job = simJobRef.current
        const targetCut = job?.cuts?.find((c) => c.cutIndex === indexTargetCutRef.current)
        const targetTheta = targetCut?.thetaDeg ?? displayThetaRef.current
        const currentTheta = displayThetaRef.current
        const delta = targetTheta - currentTheta
        const stepDeg = Math.sign(delta || 1) * indexSpeed * dt
        let nextTheta = currentTheta
        if (Math.abs(delta) <= Math.abs(stepDeg) + 1e-6) {
          nextTheta = targetTheta
        } else {
          nextTheta = currentTheta + stepDeg
        }
        displayThetaRef.current = nextTheta
        setDisplayThetaDeg(nextTheta)

        const wirePt = wireAtIndexRef.current
        if (wirePt && geometry) {
          const hit = wireFoamCollision({
            wireU: wirePt.u,
            wireV: wirePt.v,
            geometry,
            stock,
            cutMode,
            cutIndex: cutIndexRef.current,
            thetaDeg: nextTheta,
          })
          setColliding(hit)
          publishWireState(wirePt, [])
        }

        if (Math.abs(targetTheta - nextTheta) < 1e-3) {
          simAutoAdvanceRef.current = true
          advanceSimCut(indexTargetCutRef.current)
          cutIndexRef.current = indexTargetCutRef.current
          displayThetaRef.current = targetTheta
          setDisplayThetaDeg(targetTheta)
          simDistRef.current = 0
          phaseRef.current = 'cutting'
          setPhase('cutting')
          setColliding(false)
          setPathVersion((v) => v + 1)
        }
        simRafRef.current = requestAnimationFrame(step)
        return
      }

      const cut = getCurrentCut()
      const fullWirePath = cut?.fullWirePath ?? []
      const wireCum = cut?.wireCum ?? []
      const wireLengthMM = cut?.lengthMM ?? 0

      if (!(fullWirePath.length >= 2) || !(wireLengthMM > 0)) {
        simRafRef.current = requestAnimationFrame(step)
        return
      }

      const distance = Math.min(simDistRef.current + dt * wireSpeed, wireLengthMM)
      simDistRef.current = distance

      const pt = pointAtDistance(fullWirePath, wireCum, distance)
      if (pt) {
        const trail = simTrailRef.current
        const tail = trail[trail.length - 1]
        if (!tail || Math.hypot(pt.u - tail.u, pt.v - tail.v) > 1e-6) {
          trail.push({ u: pt.u, v: pt.v })
        }
        publishWireState(pt, trail)
      }

      const globalDist = completedLengthRef.current + distance
      const label = {
        n: cutIndexRef.current + 1,
        u: pt?.u ?? 0,
        v: pt?.v ?? 0,
        distance: globalDist,
      }

      if (now - simLastSampleRef.current >= SIM_SAMPLE_MS && pt) {
        simLastSampleRef.current = now
        simLogRef.current.push({
          n: cutIndexRef.current + 1,
          u: +pt.u.toFixed(2),
          v: +pt.v.toFixed(2),
          distance: +globalDist.toFixed(1),
        })
        setSimLogTick(simLogRef.current.length)
      }

      if (now - lastLabelAt >= SIM_SAMPLE_MS) {
        lastLabelAt = now
        setSimLabel(label)
        setSimDistance(distance)
        setSimGlobalDistance(globalDist)
      }

      if (distance >= wireLengthMM) {
        completedLengthRef.current += wireLengthMM
        const job = simJobRef.current
        const next = job ? nextPlayableCut(job.cuts, cutIndexRef.current) : -1
        if (next >= 0 && startIndexing(next, pt)) {
          setSimGlobalDistance(completedLengthRef.current)
          simRafRef.current = requestAnimationFrame(step)
          return
        }
        finishJob(label)
        return
      }

      phaseRef.current = 'cutting'
      setPhase('cutting')
      simRafRef.current = requestAnimationFrame(step)
    }

    simRafRef.current = requestAnimationFrame(step)
    return () => {
      if (simRafRef.current) cancelAnimationFrame(simRafRef.current)
      simRafRef.current = null
    }
  }, [
    simPlaying,
    pathVersion,
    geometry,
    stock,
    cutMode,
    wireFeedRate,
    indexFeedRate,
    advanceSimCut,
    setSimPlaying,
    publishWireState,
    simAutoAdvanceRef,
    getCurrentCut,
  ])

  // Reset per-cut progress only when cutIndex changes — never on pause.
  useEffect(() => {
    if (prevCutIndexRef.current === cutIndex) return
    prevCutIndexRef.current = cutIndex

    if (phaseRef.current === 'indexing') return
    const autoAdvance = simAutoAdvanceRef.current
    const seeking = simSeekingRef.current
    if (seeking) {
      simSeekingRef.current = false
      return
    }
    simDistRef.current = 0
    simTrailRef.current = []
    if (!autoAdvance) {
      completedLengthRef.current = 0
      setSimDistance(0)
      setSimGlobalDistance(0)
      setSimLabel(null)
      setSimLogTick(0)
    }
    syncWireMarkerPosition(0)
  }, [cutIndex, syncWireMarkerPosition, simAutoAdvanceRef])

  const handleTogglePlay = useCallback(async () => {
    if (simPlaying) {
      syncWireMarkerPosition()
      setSimPlaying(false)
      simPlayingRef.current = false
      return
    }
    if (!geometry) return

    const cut = getCurrentCut()
    const wireLengthMM = cut?.lengthMM ?? 0
    const total = jobTotalLengthMM > 0 ? jobTotalLengthMM : wireLengthMM
    const atJobEnd = total > 0 && simGlobalDistance >= total - 1e-3
    const canResume = !atJobEnd
      && wireLengthMM > 0
      && (simDistRef.current > 0 || simGlobalDistance > 0 || phaseRef.current === 'indexing')
    if (canResume) {
      if (phaseRef.current === 'idle') {
        phaseRef.current = 'cutting'
        setPhase('cutting')
      }
      setSimPlaying(true)
      simPlayingRef.current = true
      return
    }

    try {
      const job = await ensureSimJob()
      let startCut = 0
      if (!job.cuts[0]?.playable) startCut = firstPlayableCut(job.cuts)
      if (startCut < 0 || !job.cuts[startCut]?.playable) return
      resetRunState()
      const startTheta = job.cuts[startCut]?.thetaDeg ?? 0
      displayThetaRef.current = startTheta
      setDisplayThetaDeg(startTheta)
      setCutIndexForSimStart(startCut)
      cutIndexRef.current = startCut
      phaseRef.current = 'cutting'
      setPhase('cutting')
      setSimPlaying(true)
      simPlayingRef.current = true
    } catch (err) {
      console.warn('[sim] job precompute failed:', err)
    }
  }, [
    ensureSimJob,
    geometry,
    getCurrentCut,
    jobTotalLengthMM,
    resetRunState,
    setCutIndexForSimStart,
    setSimPlaying,
    simGlobalDistance,
    simPlaying,
    syncWireMarkerPosition,
  ])

  const handleReset = useCallback(() => {
    setSimPlaying(false)
    simPlayingRef.current = false
    resetRunState()
    setCutIndexForSimStart(0)
    cutIndexRef.current = 0
    displayThetaRef.current = 0
    setDisplayThetaDeg(0)
  }, [resetRunState, setCutIndexForSimStart, setSimPlaying])

  const handleStop = useCallback(() => {
    setSimPlaying(false)
    simPlayingRef.current = false
    resetRunState()
  }, [resetRunState, setSimPlaying])

  const seekToGlobalDist = useCallback(async (globalDist, job = null) => {
    setSimPlaying(false)
    simPlayingRef.current = false
    phaseRef.current = 'idle'
    setPhase('idle')
    let simJob = job ?? simJobRef.current
    if (!simJob) {
      try { simJob = await ensureSimJob() } catch { return }
    }
    const hit = seekGlobal(simJob.cuts, globalDist)
    if (!hit) return
    const cut = simJob.cuts.find((c) => c.cutIndex === hit.cutIndex)
    if (!cut?.playable) return

    completedLengthRef.current = hit.completedLength
    const global = hit.completedLength + hit.localDist
    setSimGlobalDistance(global)
    simLogRef.current = []
    simLastSampleRef.current = -Infinity
    setSimLogTick(0)

    simDistRef.current = hit.localDist
    let i = 0
    while (i < cut.wireCum.length - 2 && cut.wireCum[i + 1] < hit.localDist) i++
    const head = cut.fullWirePath.slice(0, i + 1)
    const pt = pointAtDistance(cut.fullWirePath, cut.wireCum, hit.localDist)
    simTrailRef.current = pt ? [...head, { u: pt.u, v: pt.v }] : head
    publishWireState(pt, simTrailRef.current)
    setSimDistance(hit.localDist)
    displayThetaRef.current = cut.thetaDeg
    setDisplayThetaDeg(cut.thetaDeg)
    setSimLabel({
      n: hit.cutIndex + 1,
      u: pt?.u ?? 0,
      v: pt?.v ?? 0,
      distance: global,
    })

    if (hit.cutIndex !== cutIndexRef.current) {
      simSeekingRef.current = true
      setCutIndexForSimStart(hit.cutIndex)
      cutIndexRef.current = hit.cutIndex
    }
  }, [ensureSimJob, publishWireState, setCutIndexForSimStart, setSimPlaying])

  const cut = getCurrentCut()
  const wireLengthMM = cut?.lengthMM ?? 0
  const jobTotalMM = jobTotalLengthMM > 0 ? jobTotalLengthMM : wireLengthMM

  // Always expose a marker position while sim is enabled (play, pause, or idle).
  let displayWireUV = wireUV
  if (enabled && !displayWireUV) {
    if (phaseRef.current === 'indexing' && wireAtIndexRef.current) {
      displayWireUV = wireAtIndexRef.current
    } else {
      const resolved = resolveCutWire()
      if (resolved?.fullWirePath?.length) {
        displayWireUV = pointAtDistance(
          resolved.fullWirePath,
          resolved.wireCum,
          simDistRef.current,
        ) ?? resolved.fullWirePath[0] ?? null
      }
    }
  }

  return {
    phase,
    displayThetaDeg,
    colliding,
    wireUV: displayWireUV,
    trailUV,
    simDistance,
    simGlobalDistance,
    jobTotalMM,
    wireLengthMM,
    simLabel,
    simLogTick,
    simLogRef,
    simDistRef,
    simTrailRef,
    handleTogglePlay,
    handleReset,
    handleStop,
    seekToGlobal: seekToGlobalDist,
    cutCount,
    wireFeedRate,
    indexFeedRate,
  }
}

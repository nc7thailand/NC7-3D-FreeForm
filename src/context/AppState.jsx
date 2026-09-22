import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react'
import * as THREE from 'three'
import { loadSTLFile, loadSTLFromUrl, computeBoundingBox, getBoxSize } from '../lib/stl'
import { DUMMY_STL_URL, DUMMY_STL_NAME } from '../lib/exampleStl'
import { resolveTargetMM, computeFitScale, scaleGeometry } from '../lib/resize'
import { settleGeometry, bakeMeshTransform, ensureGeometryOnFloor } from '../lib/settle'
import { applyModelBlockOffset } from '../lib/modelBlockOffset'
import { simplifyGeometry } from '../lib/simplify'
import { buildSectionProfile, buildFullSilhouettePreview, planePointFromStock, silhouetteOptsFromStock } from '../lib/toolpath'
import { buildCutJob, cutJobHasProfile, effectiveCutCount, CUT_MODE_LEFT_ONLY } from '../lib/cutJob'
import { attachIndexSafetyToJob } from '../lib/indexSafety'
import { wirePathFromProfile } from '../lib/wirePath'
import { DEFAULT_GCODE_SETTINGS } from '../lib/gcode'
import {
  packProject,
  unpackProject,
  downloadProjectBlob,
  defaultProjectFilename,
} from '../lib/project'
import { saveBrowserSession, loadBrowserSession, clearBrowserSession } from '../lib/session'
import { loadSimSettings, saveSimSettings } from '../lib/simSettings'
import { ROUTES } from '../routes'

const DEFAULT_STOCK = {
  w: 100,
  t: 100,
  h: 100,
  lo: 5,
  bo: 1,
  kerf: 2,
  topOffset: 20,
  boAuto: true,
  boMargin: 20,
  showModelBBox: true,
  profileAccuracy: 10,
  // Display-only multiplier for the 2D-derived overlay elements in Combined
  // view (cut path, link lines, markers). The silhouette contour is not scaled.
  // Lives in `stock` so it inherits the existing persistence; the G-code
  // pipeline reads only its known fields and ignores this one.
  overlayThickness: 3,
  /** Anchor for vertical model placement in the foam block (Apply on Toolpath). */
  modelOffsetType: 'bottom',
  modelOffsetMm: 0,
}
const DEFAULT_ROTATION_N = 16

/**
 * Busy-overlay timing. A job that finishes faster than BUSY_MIN_MS still shows
 * the overlay for that long, so it reads as deliberate feedback rather than a
 * flash. Jobs slower than that are unaffected.
 */
const BUSY_MIN_MS = 600

function prepareRawGeometry(geo) {
  if (!geo) return geo
  if (!geo.userData.nc7CentroidApplied) {
    geo.computeBoundingBox()
    const centroid = geo.boundingBox.getCenter(new THREE.Vector3())
    geo.translate(-centroid.x, -centroid.y, -centroid.z)
    // Drop onto the floor so the model stands on Y=0 from the moment it loads.
    // Centring alone leaves the model straddling the floor, which parks the
    // gizmo pivot at Y=0 instead of the model's real centre of mass.
    geo.computeBoundingBox()
    geo.translate(0, -geo.boundingBox.min.y, 0)
    geo.userData.nc7CentroidApplied = true
    geo.computeBoundingBox()
  }
  return geo
}

const AppStateContext = createContext(null)

export function AppStateProvider({ children }) {
  const [geometry, setGeometry] = useState(null)
  const [stats, setStats] = useState(null)
  const [status, setStatus] = useState('')
  const [unit, setUnit] = useState('mm')
  const [target, setTarget] = useState({ x: 100, y: 100, z: 100 })
  const [resetKey, setResetKey] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)

  // Blocking busy state for long synchronous jobs: { active, message, progress }
  // progress is null when the job cannot report a step count.
  const [busy, setBusy] = useState({ active: false, message: '', progress: null })

  const [stock, setStock] = useState(DEFAULT_STOCK)
  const [rotationN, setRotationN] = useState(DEFAULT_ROTATION_N)
  // CAM convention: the blocking setup panel forces an explicit mode choice
  // every session, so the default is a starting suggestion rather than a silent
  // choice. Left only = one half per rotation (16 cuts at N=16).
  const [cutMode, setCutMode] = useState(CUT_MODE_LEFT_ONLY)
  const [cutIndex, setCutIndex] = useState(0)
  const [profile, setProfile] = useState(null)
  const [silhouettePreview, setSilhouettePreview] = useState(null)
  const [cutJob, setCutJob] = useState(null)
  const [gcodeSettings, setGcodeSettings] = useState(DEFAULT_GCODE_SETTINGS)
  const [toolpathTick, setToolpathTick] = useState(0)
  const [modelName, setModelName] = useState(DUMMY_STL_NAME)
  const [sessionReady, setSessionReady] = useState(false)
  const [hydrating, setHydrating] = useState(true)
  const [toolpathSetupOpen, setToolpathSetupOpen] = useState(false)
  // Experimental Sim module (2D panel only). Ephemeral view state — not part of
  // the project/session persistence, not read by the G-code pipeline.
  const [simActive, setSimActive] = useState(false)
  const [simPlaying, setSimPlaying] = useState(false)
  // Playback preferences for the 2D wire simulator. Seeded from localStorage and
  // persisted there alone — deliberately NOT in the project manifest or in
  // `gcodeSettings`, so simulator tuning can never alter emitted G-code.
  const [simSettings, setSimSettings] = useState(() => loadSimSettings())
  const [simPanelOpen, setSimPanelOpen] = useState(false)
  // Set true before programmatic cutIndex changes during full-job sim playback so
  // the cutIndex effect does not pause simPlaying.
  const simAutoAdvanceRef = useRef(false)

  const workingRef = useRef(null)
  const viewerRef = useRef(null)
  const planePoint = useRef(planePointFromStock(DEFAULT_STOCK))

  const cutCount = effectiveCutCount(rotationN, { mode: cutMode })
  const thetaDeg = rotationN >= 1 ? (cutIndex * 360) / cutCount : 0

  /**
   * Busy helpers. Long jobs are synchronous in JS, so the overlay has to be
   * painted before the work starts — callers must await a paint tick after
   * beginBusy() and before running the job (see yieldToPaint below).
   */
  const busyShownAtRef = useRef(0)

  const beginBusy = useCallback((message, progress = null) => {
    busyShownAtRef.current = performance.now()
    setBusy({ active: true, message, progress })
  }, [])

  const setBusyProgress = useCallback((done, total) => {
    setBusy((prev) => (prev.active ? { ...prev, progress: { done, total } } : prev))
  }, [])

  const endBusy = useCallback(async () => {
    // Keep the overlay up for a minimum time so a fast job does not flash a
    // barely-visible overlay — a blink reads as a glitch, not as feedback.
    const elapsed = performance.now() - busyShownAtRef.current
    const remaining = BUSY_MIN_MS - elapsed
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining))
    setBusy({ active: false, message: '', progress: null })
  }, [])

  /** Resolve after the browser has had a chance to paint. */
  const yieldToPaint = useCallback(
    () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))),
    []
  )

  const updateStatsOnly = useCallback((geo) => {
    const box = computeBoundingBox(geo)
    const size = getBoxSize(box)
    const triangles = geo.index
      ? geo.index.count / 3
      : geo.attributes.position.count / 3
    setStats({
      sizeMM: size,
      sizeInch: {
        x: size.x / 25.4,
        y: size.y / 25.4,
        z: size.z / 25.4,
      },
      triangles,
    })
  }, [])

  const updateStatsFrom = useCallback((geo) => {
    updateStatsOnly(geo)
    const size = getBoxSize(computeBoundingBox(geo))
    setStock((prev) => ({
      ...prev,
      w: Math.ceil(size.x + 10),
      t: Math.ceil(size.z + 10),
      h: Math.ceil(size.y + 5),
    }))
  }, [updateStatsOnly])

  /** Bake gizmo transform into geometry without clearing toolpath state. */
  const bakeModelTransform = useCallback(() => {
    if (!workingRef.current) return false
    const worldMatrix = viewerRef.current?.getMeshWorldMatrix?.() ?? null
    if (worldMatrix) {
      const e = worldMatrix.elements
      const isIdentity = !e || (
        e[0] === 1 && e[1] === 0 && e[2] === 0 && e[3] === 0 &&
        e[4] === 0 && e[5] === 1 && e[6] === 0 && e[7] === 0 &&
        e[8] === 0 && e[9] === 0 && e[10] === 1 && e[11] === 0 &&
        e[12] === 0 && e[13] === 0 && e[14] === 0 && e[15] === 1
      )
      if (!isIdentity) {
        bakeMeshTransform(workingRef.current, worldMatrix)
        viewerRef.current?.resetMeshTransform?.()
        workingRef.current.userData.nc7CentroidApplied = true
        setGeometry(workingRef.current)
        updateStatsFrom(workingRef.current)
      }
    }
    return true
  }, [updateStatsFrom])

  const applyRestoredSession = useCallback((data) => {
    data.geometry.userData.nc7CentroidApplied = true
    workingRef.current = data.geometry
    setGeometry(data.geometry)
    setModelName(data.modelName)
    // Merge over defaults: a session saved before a stock field existed omits
    // that key, and replacing wholesale would drop it — which also hid the new
    // field from the setup panel's dirty check, silently discarding its edits.
    setStock({ ...DEFAULT_STOCK, ...data.stock })
    setRotationN(data.rotationN)
    setCutIndex(data.cutIndex)
    setCutJob(data.cutJob)
    if (data.cutJob?.mode) setCutMode(data.cutJob.mode)
    setGcodeSettings({ ...DEFAULT_GCODE_SETTINGS, ...data.gcodeSettings })
    if (data.cutJob?.cuts) {
      for (const cut of data.cutJob.cuts) {
        if (!cut.wirePath?.length && cut.profile?.polylines?.length) {
          cut.wirePath = wirePathFromProfile(cut.profile, data.stock, cut.thetaDeg)
        }
      }
    }
    setProfile(data.cutJob?.cuts?.[data.cutIndex]?.profile ?? null)
    updateStatsOnly(data.geometry)
    setResetKey((k) => k + 1)
    setToolpathTick((t) => t + 1)
  }, [updateStatsOnly])

  useEffect(() => {
    let cancelled = false

    async function initSession() {
      // Panel states default closed; never resurrect overlays after a reload.
      setToolpathSetupOpen(false)
      setSimPanelOpen(false)
      setMenuOpen(false)

      setStatus('Restoring session…')
      try {
        const restored = await loadBrowserSession()
        if (cancelled) return
        if (restored?.geometry) {
          applyRestoredSession(restored)
          setStatus('Session restored — pick up where you left off.')
          setHydrating(false)
          setSessionReady(true)
          return
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('Session restore failed:', err)
          await clearBrowserSession().catch(() => {})
        }
      }

      setStatus('Loading dummy STL...')
      try {
        const rawGeo = await loadSTLFromUrl(DUMMY_STL_URL)
        if (cancelled) return
        const geo = prepareRawGeometry(rawGeo)
        workingRef.current = geo
        setGeometry(geo)
        updateStatsFrom(geo)
        setModelName(DUMMY_STL_NAME)
        setStatus(`Loaded dummy ${DUMMY_STL_NAME} (${geo.attributes.position.count / 3} triangles)`)
      } catch (err) {
        if (!cancelled) setStatus(`Error: ${err.message}`)
      }
      if (!cancelled) {
        setHydrating(false)
        setSessionReady(true)
      }
    }

    initSession()
    return () => { cancelled = true }
  }, [applyRestoredSession, updateStatsFrom])

  // Preview the buffered cut for the current index. Everything is computed in
  // one batch on Apply, so stepping through cuts never re-runs a silhouette.
  useEffect(() => {
    if (cutJob?.cuts?.length) {
      const cut = cutJob.cuts[Math.min(cutIndex, cutJob.cuts.length - 1)]
      setProfile(cut?.profile ?? null)
      return
    }
    // No batch yet (first visit, or settings changed but not applied): show a
    // single preview so the page is not empty.
    const geo = workingRef.current
    if (!geo) {
      setProfile(null)
      setSilhouettePreview(null)
      return
    }
    const settled = ensureGeometryOnFloor(geo)
    if (settled) {
      geo.userData.nc7CentroidApplied = true
      setGeometry(geo)
      updateStatsFrom(geo)
      viewerRef.current?.refreshMeshPivot?.()
    }
    planePoint.current.copy(planePointFromStock(stock))
    const worldMatrix = null
    const silhouetteOpts = silhouetteOptsFromStock(stock)
    try {
      setProfile(buildSectionProfile(geo, thetaDeg, planePoint.current, worldMatrix, silhouetteOpts))
      setSilhouettePreview(
        buildFullSilhouettePreview(geo, thetaDeg, planePoint.current, worldMatrix, silhouetteOpts)
      )
    } catch (err) {
      setProfile(null)
      setSilhouettePreview(null)
      setStatus(`Toolpath error: ${err.message}`)
    }
  }, [cutIndex, cutJob, thetaDeg, stock.t, stock.w, stock.h, stock.lo, stock.kerf, stock.profileAccuracy, geometry, toolpathTick, updateStatsFrom])

  // Changing settings only clamps which cut is previewed. The buffered job is
  // kept until the user presses Apply, so ◀ ▶ stays instant in the meantime.
  useEffect(() => {
    if (hydrating) return
    setCutIndex((i) => Math.min(i, Math.max(effectiveCutCount(rotationN, { mode: cutMode }) - 1, 0)))
  }, [rotationN, cutMode, hydrating])

  const advanceSimCut = useCallback((nextIndex) => {
    simAutoAdvanceRef.current = true
    setCutIndex(nextIndex)
  }, [])

  const setCutIndexForSimStart = useCallback((index) => {
    simAutoAdvanceRef.current = true
    setCutIndex(index)
  }, [])

  const setCutIndexManual = useCallback((updater) => {
    setSimPlaying(false)
    setCutIndex(updater)
  }, [])

  // Manual cut stepping pauses sim; auto-advance during full-job playback does not.
  useEffect(() => {
    if (simAutoAdvanceRef.current) {
      simAutoAdvanceRef.current = false
      return
    }
    setSimPlaying(false)
  }, [cutIndex])

  useEffect(() => {
    if (!simActive) setSimPlaying(false)
  }, [simActive])

  // Settings changes do NOT invalidate the buffered job — it is replaced on
  // Apply. Keeping it lets the user keep browsing cuts while editing values.

  useEffect(() => {
    if (!sessionReady || hydrating || !geometry) return undefined
    const timer = setTimeout(() => {
      bakeModelTransform()
      const geoToSave = workingRef.current || geometry
      saveBrowserSession({
        geometry: geoToSave,
        modelName,
        stock,
        rotationN,
        cutIndex,
        cutJob: cutJobHasProfile(cutJob) ? cutJob : null,
        gcodeSettings,
      }).catch((err) => console.warn('Session save failed:', err))
    }, 800)
    return () => clearTimeout(timer)
  }, [
    sessionReady,
    hydrating,
    geometry,
    modelName,
    stock,
    rotationN,
    cutIndex,
    cutJob,
    gcodeSettings,
    bakeModelTransform,
  ])

  const handleFile = async (file) => {
    setStatus('Loading STL...')
    beginBusy(`Loading ${file.name}…`, { done: 0, total: 100 })
    await yieldToPaint()
    try {
      const rawGeo = await loadSTLFile(file, {
        onReadProgress: (loaded, total) => {
          // Reading is typically fast; cap it below 100 so the bar does not sit
          // full while parse + normals still run.
          setBusyProgress(Math.round((loaded / total) * 70), 100)
        },
        onStage: (stage) => {
          // Parse and normals have no byte progress — show the stage with an
          // indeterminate-looking bar so we are not implying a known fraction.
          setBusy(() => ({ active: true, message: stage, progress: null }))
        },
      })
      const geo = prepareRawGeometry(rawGeo)
      workingRef.current = geo
      setGeometry(geo)
      updateStatsFrom(geo)
      setModelName(file.name)
      setCutJob(null)
      setCutIndex(0)
      setMenuOpen(false)
      setStatus(`Loaded ${file.name} (${geo.attributes.position.count / 3} triangles)`)
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    } finally {
      await endBusy()
    }
  }

  const handleResize = () => {
    if (!workingRef.current) { setStatus('Load an STL first.'); return }
    const box = computeBoundingBox(workingRef.current)
    const size = getBoxSize(box)
    const targetMM = resolveTargetMM(target, unit)
    const factor = computeFitScale(size, targetMM)
    scaleGeometry(workingRef.current, factor)
    workingRef.current.userData.nc7CentroidApplied = true
    setGeometry(workingRef.current)
    updateStatsFrom(workingRef.current)
    setStatus(`Scaled by factor ${factor.toFixed(4)} to fit target (${unit}).`)
  }

  const handleSettle = () => {
    if (!workingRef.current) { setStatus('Load an STL first.'); return }
    // Bake the current gizmo pose into the vertices, drop the model so its
    // bounding box bottom touches Y=0, then restore the gizmo rest pose.
    // Resetting first would leave the baked pose applied twice.
    const worldMatrix = viewerRef.current?.getMeshWorldMatrix?.() ?? null
    settleGeometry(workingRef.current, { worldMatrix })
    viewerRef.current?.resetMeshTransform?.()
    workingRef.current.userData.nc7CentroidApplied = true
    setGeometry(workingRef.current)
    updateStatsFrom(workingRef.current)
    setStatus('Settled: lowest point of bounding box placed on floor (Y=0).')
  }

  const handleCenter = () => {
    if (!workingRef.current) { setStatus('Load an STL first.'); return }
    viewerRef.current?.centerMesh?.()
    setStatus('Centred on turntable: centre of mass moved to X0, Z0 (Y unchanged).')
  }

  const handleSimplify = (ratio) => {
    if (!workingRef.current) { setStatus('Load an STL first.'); return }
    const result = simplifyGeometry(workingRef.current, { ratio })
    result.geometry.userData.nc7CentroidApplied = true
    workingRef.current = result.geometry
    setGeometry(result.geometry)
    updateStatsFrom(result.geometry)
    setStatus(`Simplified: ${result.originalTriangles} → ${result.newTriangles} triangles`)
  }

  const handleExport = () => {
    if (!workingRef.current) { setStatus('Load an STL first.'); return }
    import('../lib/export').then(({ exportSTL }) => {
      exportSTL(workingRef.current, 'nc7-export.stl')
      setStatus('Exported STL.')
    })
  }

  const handleReset = async () => {
    await clearBrowserSession().catch(() => {})
    viewerRef.current?.resetMeshTransform?.()
    workingRef.current = null
    setGeometry(null)
    setStats(null)
    setProfile(null)
    setSilhouettePreview(null)
    setCutJob(null)
    setModelName(DUMMY_STL_NAME)
    setStatus('')
    setResetKey((k) => k + 1)
    setStatus('Loading dummy STL...')
    try {
      const rawGeo = await loadSTLFromUrl(DUMMY_STL_URL)
      const geo = prepareRawGeometry(rawGeo)
      workingRef.current = geo
      setGeometry(geo)
      updateStatsFrom(geo)
      setModelName(DUMMY_STL_NAME)
      setStatus(`Loaded dummy ${DUMMY_STL_NAME}`)
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    }
  }

  const handleGcodeSettingsChange = (key, value) => {
    setGcodeSettings((prev) => ({ ...prev, [key]: value }))
  }

  /** Update one playback preference and persist it immediately. */
  const updateSimSettings = useCallback((patch) => {
    setSimSettings((prev) => {
      const next = { ...prev, ...patch }
      saveSimSettings(patch)
      return next
    })
  }, [])

  const openSimPanel = useCallback(() => setSimPanelOpen(true), [])
  const closeSimPanel = useCallback(() => setSimPanelOpen(false), [])

  const handleStockChange = (key, value) => {
    setStock((prev) => ({ ...prev, [key]: value }))
  }

  const handleMeshTransformChange = () => {
    setToolpathTick((t) => t + 1)
  }

  /** Commit gizmo transform into geometry before leaving Page 1. */
  const saveModelStage = useCallback(() => {
    if (!bakeModelTransform()) return false
    if (workingRef.current) {
      settleGeometry(workingRef.current)
      workingRef.current.userData.nc7CentroidApplied = true
      setGeometry(workingRef.current)
      updateStatsFrom(workingRef.current)
    }
    setProfile(null)
    setSilhouettePreview(null)
    setCutJob(null)
    setCutIndex(0)
    setToolpathTick((t) => t + 1)
    setStatus('Model saved — settled on floor, ready for toolpath.')
    return true
  }, [bakeModelTransform, updateStatsFrom])

  const computeCutJob = useCallback(async (onProgress, stockOverride = null, cutModeOverride = null) => {
    const geo = workingRef.current
    if (!geo) return null
    const s = stockOverride ?? stock
    const mode = cutModeOverride ?? cutMode
    planePoint.current.copy(planePointFromStock(s))
    const job = await buildCutJob(geo, rotationN, planePoint.current, {
      silhouetteOpts: silhouetteOptsFromStock(s),
      mode,
      onProgress,
    })
    job.stock = { ...s }
    for (const cut of job.cuts) {
      cut.wirePath = wirePathFromProfile(cut.profile, s, cut.thetaDeg)
    }
    attachIndexSafetyToJob(job, geo, s, mode)
    return job
  }, [rotationN, cutMode, stock])

  const saveToolpathStage = useCallback(async (stockOverride = null, cutModeOverride = null) => {
    const geo = workingRef.current
    if (!geo) return false
    const mode = cutModeOverride ?? cutMode
    const total = effectiveCutCount(rotationN, { mode })
    setStatus(`Computing ${total} cuts (N=${rotationN}, ${mode})…`)
    beginBusy('Computing toolpath…', { done: 0, total })
    await yieldToPaint()
    try {
      const job = await computeCutJob(async (done, count) => {
        setBusyProgress(done, count)
        await yieldToPaint()
      }, stockOverride, cutModeOverride)
      if (!cutJobHasProfile(job)) {
        setStatus('No cross-section found — check model or rotation count.')
        return false
      }
      setCutJob(job)
      const withProfile = job.cuts.filter((c) => c.profile.polylines.length > 0).length
      setStatus(`Toolpath saved: ${withProfile}/${job.cutCount ?? job.cuts.length} cuts (N=${job.rotationN}, ${mode}).`)
      return true
    } catch (err) {
      setStatus(`Toolpath error: ${err.message}`)
      return false
    } finally {
      await endBusy()
    }
  }, [computeCutJob, rotationN, cutMode, beginBusy, setBusyProgress, endBusy, yieldToPaint])

  /** Bake gizmo, apply foam-block vertical offset, refresh geometry (new clone for React). */
  const applyModelBlockOffsetFromStock = useCallback((stockSnapshot = stock) => {
    if (!workingRef.current) return false
    bakeModelTransform()
    applyModelBlockOffset(
      workingRef.current,
      stockSnapshot,
      stockSnapshot.modelOffsetType ?? 'bottom',
      stockSnapshot.modelOffsetMm ?? 0,
    )
    viewerRef.current?.resetMeshTransform?.()
    const geo = workingRef.current.clone()
    geo.userData = { ...workingRef.current.userData, nc7CentroidApplied: true }
    workingRef.current = geo
    setGeometry(geo)
    updateStatsOnly(geo)
    setToolpathTick((t) => t + 1)
    setProfile(null)
    setSilhouettePreview(null)
    return true
  }, [bakeModelTransform, stock, updateStatsOnly])

  /**
   * Toolpath page Apply button. Recomputes every cut for the current settings
   * and resets the preview to the first cut.
   */
  const applyToolpathSettings = useCallback(async () => {
    applyModelBlockOffsetFromStock()
    const ok = await saveToolpathStage()
    if (ok) setCutIndex(0)
    return ok
  }, [applyModelBlockOffsetFromStock, saveToolpathStage])

  /**
   * Commit draft toolpath settings (stock + cut mode) and recompute. Used by
   * the Toolpath Setup panel's Apply button: draft values are copied into
   * applied state, then the cut job is rebuilt with the NEW values (passed
   * explicitly to avoid stale-closure reads). Set cutIndex to 0 so the first
   * cut is shown with the new settings.
   */
  const commitToolpathSettings = useCallback(async ({ stock: newStock, cutMode: newCutMode }) => {
    setStock({ ...newStock })
    setCutMode(newCutMode)
    applyModelBlockOffsetFromStock(newStock)
    const ok = await saveToolpathStage(newStock, newCutMode)
    if (ok) setCutIndex(0)
    return ok
  }, [applyModelBlockOffsetFromStock, saveToolpathStage])

  const openToolpathSetup = useCallback(() => setToolpathSetupOpen(true), [])
  const closeToolpathSetup = useCallback(() => setToolpathSetupOpen(false), [])

  const handleSaveProject = useCallback(async () => {
    if (!workingRef.current) {
      setStatus('Load a model before saving a project.')
      return
    }

    setStatus('Saving project…')
    beginBusy('Saving project…')
    await yieldToPaint()
    try {
      bakeModelTransform()
      let job = cutJob
      if (!cutJobHasProfile(job)) {
        job = await computeCutJob()
      } else if (job.rotationN !== rotationN || job.mode !== cutMode) {
        job = await computeCutJob()
      }

      const blob = await packProject({
        geometry: workingRef.current,
        modelName,
        stock,
        rotationN,
        cutIndex,
        cutJob: cutJobHasProfile(job) ? job : null,
        gcodeSettings,
      })

      downloadProjectBlob(blob, defaultProjectFilename(modelName))

      if (cutJobHasProfile(job)) {
        setCutJob(job)
        const activeCut = job.cuts[Math.min(cutIndex, job.cuts.length - 1)]
        setProfile(activeCut?.profile ?? null)
      }

      setToolpathTick((t) => t + 1)
      setStatus(`Saved ${defaultProjectFilename(modelName)}`)
    } catch (err) {
      setStatus(`Save failed: ${err.message}`)
    } finally {
      await endBusy()
    }
  }, [bakeModelTransform, computeCutJob, cutJob, cutIndex, cutMode, gcodeSettings, modelName, rotationN, stock, beginBusy, endBusy, yieldToPaint])

  const handleOpenProject = useCallback(async (file) => {
    setStatus('Opening project…')
    try {
      const data = await unpackProject(file)
      workingRef.current = data.geometry
      setGeometry(data.geometry)
      setModelName(data.modelName)
      // Same forward-compatibility merge as applyRestoredSession: an older
      // .nc7project predates any stock field added since, and must not lose it.
      setStock({ ...DEFAULT_STOCK, ...data.stock })
      setRotationN(data.rotationN)
      setCutIndex(data.cutIndex)
      setCutJob(data.cutJob)
      if (data.cutJob?.mode) setCutMode(data.cutJob.mode)
      setGcodeSettings({ ...DEFAULT_GCODE_SETTINGS, ...data.gcodeSettings })
      if (data.cutJob?.cuts) {
        for (const cut of data.cutJob.cuts) {
          if (!cut.wirePath?.length && cut.profile?.polylines?.length) {
            cut.wirePath = wirePathFromProfile(cut.profile, data.stock, cut.thetaDeg)
          }
        }
      }
      setProfile(data.cutJob?.cuts?.[data.cutIndex]?.profile ?? null)
      updateStatsOnly(data.geometry)
      viewerRef.current?.resetMeshTransform?.()
      setResetKey((k) => k + 1)
      setToolpathTick((t) => t + 1)

      const route = data.hasToolpath ? ROUTES.gcode : ROUTES.model
      setStatus(`Opened ${file.name}${data.hasToolpath ? ' — toolpath restored.' : '.'}`)
      return { route }
    } catch (err) {
      setStatus(`Open failed: ${err.message}`)
      return null
    }
  }, [updateStatsOnly])

  const value = {
    geometry,
    stats,
    status,
    setStatus,
    unit,
    setUnit,
    target,
    setTarget,
    resetKey,
    menuOpen,
    setMenuOpen,
    busy,
    beginBusy,
    setBusyProgress,
    endBusy,
    yieldToPaint,
    stock,
    rotationN,
    setRotationN,
    cutMode,
    setCutMode,
    cutCount,
    cutIndex,
    setCutIndex,
    setCutIndexManual,
    setCutIndexForSimStart,
    advanceSimCut,
    simAutoAdvanceRef,
    thetaDeg,
    profile,
    silhouettePreview,
    cutJob,
    gcodeSettings,
    setGcodeSettings,
    handleGcodeSettingsChange,
    modelName,
    workingRef,
    viewerRef,
    sessionReady,
    hasModel: !!geometry,
    hasToolpath: cutJobHasProfile(cutJob) || !!profile?.polylines?.length,
    hasToolpathSaved: cutJobHasProfile(cutJob),
    handleFile,
    handleResize,
    handleSettle,
    handleSimplify,
    handleExport,
    handleReset,
    handleCenter,
    handleStockChange,
    commitToolpathSettings,
    toolpathSetupOpen,
    openToolpathSetup,
    closeToolpathSetup,
    simActive,
    setSimActive,
    simPlaying,
    setSimPlaying,
    simSettings,
    updateSimSettings,
    simPanelOpen,
    openSimPanel,
    closeSimPanel,
    handleMeshTransformChange,
    saveModelStage,
    saveToolpathStage,
    applyToolpathSettings,
    applyModelBlockOffsetFromStock,
    handleSaveProject,
    handleOpenProject,
  }

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  )
}

export function useAppState() {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider')
  return ctx
}

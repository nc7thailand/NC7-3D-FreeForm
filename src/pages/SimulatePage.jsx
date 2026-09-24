import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PageNav from '../components/PageNav'
import SimulateViewer from '../components/SimulateViewer'
import { useAppState } from '../context/AppState'
import { buildPlaybackTimeline, buildWireStack, sampleTimeline } from '../lib/simStack'
import { wireSpeedMmPerSec } from '../lib/turntablePhysics'
import { SIMULATE_ROUTE_DETACHED } from '../routes'

export default function SimulatePage() {
  const { geometry, cutJob, resetKey, gcodeSettings } = useAppState()
  const [wireOnly, setWireOnly] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [globalSeg, setGlobalSeg] = useState(0)
  const [segT, setSegT] = useState(0)
  const rafRef = useRef(null)
  const lastTimeRef = useRef(null)
  const playingRef = useRef(false)
  const playStateRef = useRef({ seg: 0, t: 0 })

  useEffect(() => {
    playingRef.current = playing
  }, [playing])

  const stack = useMemo(() => (cutJob ? buildWireStack(cutJob) : []), [cutJob])
  const timeline = useMemo(() => buildPlaybackTimeline(stack), [stack])

  useEffect(() => {
    playStateRef.current = { seg: globalSeg, t: segT }
  }, [globalSeg, segT])

  const sample = useMemo(
    () => (timeline.length ? sampleTimeline(timeline, globalSeg, segT) : null),
    [timeline, globalSeg, segT],
  )

  const activeCutIndex = sample?.cutIndex ?? 0
  const playbackPoint = sample?.point ?? null

  const resetPlayback = useCallback(() => {
    playStateRef.current = { seg: 0, t: 0 }
    setGlobalSeg(0)
    setSegT(0)
    setPlaying(false)
    lastTimeRef.current = null
  }, [])

  useEffect(() => {
    resetPlayback()
  }, [cutJob, resetPlayback])

  useEffect(() => {
    if (!playing || !timeline.length) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      lastTimeRef.current = null
      return undefined
    }

    const step = (now) => {
      if (lastTimeRef.current == null) lastTimeRef.current = now
      const dt = (now - lastTimeRef.current) / 1000
      lastTimeRef.current = now

      const mmPerSec = wireSpeedMmPerSec(gcodeSettings?.feedRate ?? 700, speed)
      let remaining = mmPerSec * dt
      let { seg, t } = playStateRef.current

      while (remaining > 0 && seg < timeline.length) {
        const { from, to } = timeline[seg]
        const len = from.distanceTo(to)
        if (len < 1e-6) {
          seg += 1
          t = 0
          continue
        }
        const need = (1 - t) * len
        if (remaining >= need) {
          remaining -= need
          seg += 1
          t = 0
        } else {
          t += remaining / len
          remaining = 0
        }
      }

      if (seg >= timeline.length) {
        seg = timeline.length - 1
        t = 1
        setPlaying(false)
      }

      playStateRef.current = { seg, t }
      setGlobalSeg(seg)
      setSegT(t)
      if (playingRef.current && seg < timeline.length) {
        rafRef.current = requestAnimationFrame(step)
      }
    }

    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [playing, timeline, speed, gcodeSettings?.feedRate])

  const handleScrub = (e) => {
    const v = +e.target.value
    playStateRef.current = { seg: v, t: 0 }
    setGlobalSeg(v)
    setSegT(0)
    setPlaying(false)
  }

  if (!cutJob) {
    return (
      <main className="page-main">
        <div className="page-body">
          <div className="placeholder-page">
            <div className="section-label">Simulation (detached)</div>
            {SIMULATE_ROUTE_DETACHED && (
              <p className="detached-route-flag">This page is not part of the main Model → Toolpath → G-code workflow.</p>
            )}
            <div className="placeholder-content">
              <p className="placeholder-note">No saved cut job — go back to Page 2 and press Next to commit the toolpath.</p>
            </div>
          </div>
        </div>
        <PageNav page="simulate" />
      </main>
    )
  }

  return (
    <main className="page-main page-main--simulate">
      <div className="page-body">
        <div className="section-label section-label-row simulate-header">
          <span>Simulation (detached)</span>
          <span className="simulate-header-meta">{stack.length} wire profiles · {timeline.length} segments</span>
        </div>
        {SIMULATE_ROUTE_DETACHED && (
          <p className="detached-route-flag">This page is not part of the main Model → Toolpath → G-code workflow.</p>
        )}

        <div className="simulate-layout">
          <aside className="simulate-controls">
            <h3>Playback</h3>
            <div className="simulate-transport">
              <button type="button" className="cut-nav-btn" onClick={resetPlayback} title="Reset">
                ⏮
              </button>
              <button
                type="button"
                className="header-next-btn"
                onClick={() => setPlaying((p) => !p)}
                disabled={!timeline.length}
              >
                {playing ? 'Pause' : 'Play'}
              </button>
            </div>

            <label>Speed ×
              <input type="range" min="0.25" max="4" step="0.25" value={speed} onChange={(e) => setSpeed(+e.target.value)} />
              <span className="range-value">{speed.toFixed(2)}</span>
            </label>

            <label>Scrub
              <input
                type="range"
                min="0"
                max={Math.max(timeline.length - 1, 0)}
                value={globalSeg}
                onChange={handleScrub}
                disabled={!timeline.length}
              />
            </label>

            <p className="panel-hint">
              Cut {activeCutIndex + 1}/{cutJob.cutCount ?? cutJob.cuts.length}
              {sample && ` · θ ${stack.find((p) => p.index === activeCutIndex)?.thetaDeg.toFixed(1) ?? 0}°`}
            </p>

            <label className="checkbox-label">
              <input type="checkbox" checked={wireOnly} onChange={(e) => setWireOnly(e.target.checked)} />
              Wire paths only (hide mesh)
            </label>

            <p className="panel-hint simulate-hint">
              Red lines = stacked cut wire (DevFoam-style). Green dot = playback head.
            </p>
          </aside>

          <section className="simulate-viewport-section">
            <SimulateViewer
              geometry={geometry}
              cutJob={cutJob}
              resetKey={resetKey}
              wireOnly={wireOnly}
              activeCutIndex={activeCutIndex}
              playbackPoint={playbackPoint}
            />
          </section>
        </div>
      </div>
      <PageNav page="simulate" />
    </main>
  )
}

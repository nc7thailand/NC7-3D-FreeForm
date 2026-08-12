import React, { useRef, useState } from 'react'
import Viewer3D from './components/Viewer3D'
import { loadSTLFile, computeBoundingBox, getBoxSize } from './lib/stl'
import { resolveTargetMM, computeFitScale, scaleGeometry } from './lib/resize'
import { settleGeometry } from './lib/settle'
import { simplifyGeometry } from './lib/simplify'
import './index.css'

export default function App() {
  const [geometry, setGeometry] = useState(null)
  const [stats, setStats] = useState(null)
  const [status, setStatus] = useState('')
  const [unit, setUnit] = useState('mm')
  const [target, setTarget] = useState({ x: 100, y: 100, z: 100 })
  const [resetKey, setResetKey] = useState(0)

  // Hold the working geometry in a ref so buttons can mutate it
  const workingRef = useRef(null)

  const updateStatsFrom = (geo) => {
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
  }

  const handleFile = async (file) => {
    setStatus('Loading STL...')
    try {
      const geo = await loadSTLFile(file)
      workingRef.current = geo
      setGeometry(geo)
      updateStatsFrom(geo)
      setStatus(`Loaded ${file.name} (${geo.attributes.position.count / 3} triangles)`)
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    }
  }

  const handleResize = () => {
    if (!workingRef.current) { setStatus('Load an STL first.'); return }
    const box = computeBoundingBox(workingRef.current)
    const size = getBoxSize(box)
    const targetMM = resolveTargetMM(target, unit)
    const factor = computeFitScale(size, targetMM)
    scaleGeometry(workingRef.current, factor)
    setGeometry(workingRef.current)
    updateStatsFrom(workingRef.current)
    setStatus(`Scaled by factor ${factor.toFixed(4)} to fit target (${unit}).`)
  }

  const handleSettle = () => {
    if (!workingRef.current) { setStatus('Load an STL first.'); return }
    settleGeometry(workingRef.current)
    setGeometry(workingRef.current)
    updateStatsFrom(workingRef.current)
    setStatus('Auto-oriented: settled model onto flat plane.')
  }

  const handleSimplify = (ratio) => {
    if (!workingRef.current) { setStatus('Load an STL first.'); return }
    const result = simplifyGeometry(workingRef.current, { ratio })
    workingRef.current = result.geometry
    setGeometry(result.geometry)
    updateStatsFrom(result.geometry)
    setStatus(`Simplified: ${result.originalTriangles} → ${result.newTriangles} triangles`)
  }

  const handleExport = () => {
    if (!workingRef.current) { setStatus('Load an STL first.'); return }
    import('./lib/export').then(({ exportSTL }) => {
      exportSTL(workingRef.current, 'nc7-export.stl')
      setStatus('Exported STL.')
    })
  }

  const handleReset = () => {
    workingRef.current = null
    setGeometry(null)
    setStats(null)
    setStatus('')
    setResetKey((k) => k + 1)
  }

  return (
    <div className="app">
      <header className="header">
        <h1>NC7 Studio3D CAM</h1>
        <p>Phase 1 — STL Load, Resize, Settle & Simplify</p>
      </header>

      <div className="content">
        {/* Section 1 — ControlPanel */}
        <aside className="control-panel">
          <section className="panel">
            <h2>Load STL</h2>
            <input
              type="file"
              accept=".stl"
              onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
            />
          </section>

          <section className="panel">
            <h2>Resize</h2>
            <div className="unit-select">
              <label><input type="radio" checked={unit === 'mm'} onChange={() => setUnit('mm')} /> mm</label>
              <label><input type="radio" checked={unit === 'inch'} onChange={() => setUnit('inch')} /> inch</label>
            </div>
            <div className="inputs">
              <label>X <input type="number" value={target.x} onChange={(e) => setTarget({ ...target, x: +e.target.value })} /></label>
              <label>Y <input type="number" value={target.y} onChange={(e) => setTarget({ ...target, y: +e.target.value })} /></label>
              <label>Z <input type="number" value={target.z} onChange={(e) => setTarget({ ...target, z: +e.target.value })} /></label>
            </div>
            <button onClick={handleResize}>Apply Resize</button>
          </section>

          <section className="panel">
            <h2>Settle</h2>
            <button onClick={handleSettle}>Auto-Orient</button>
          </section>

          <section className="panel">
            <h2>Simplify</h2>
            <button onClick={() => handleSimplify(0.75)}>75%</button>
            <button onClick={() => handleSimplify(0.5)}>50%</button>
            <button onClick={() => handleSimplify(0.25)}>25%</button>
          </section>

          <section className="panel">
            <h2>Actions</h2>
            <button onClick={handleExport}>Export STL</button>
            <button onClick={handleReset}>Reset</button>
          </section>
        </aside>

        {/* Section 2 & 3 — combined viewport */}
        <main className="viewport-area">
          <Viewer3D geometry={geometry} resetKey={resetKey} />
          {status && <div className="status-bar">{status}</div>}
        </main>
      </div>

      {stats && (
        <footer className="stats">
          <div>Size: {stats.sizeMM.x.toFixed(2)} × {stats.sizeMM.y.toFixed(2)} × {stats.sizeMM.z.toFixed(2)} mm</div>
          <div>Size: {stats.sizeInch.x.toFixed(3)} × {stats.sizeInch.y.toFixed(3)} × {stats.sizeInch.z.toFixed(3)} in</div>
          <div>Triangles: {stats.triangles.toLocaleString()}</div>
        </footer>
      )}
    </div>
  )
}

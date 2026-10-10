import React, { useCallback, useRef, useState } from 'react'
import SmartNumberInput from '../components/SmartNumberInput'
import Viewer3D from '../components/Viewer3D'
import ProjectPanel from '../components/ProjectPanel'
import PageNav from '../components/PageNav'
import {
  ImportRecommendationDialog,
  ImportMeshReduceDialog,
  LargeFileWarningDialog,
  OptimizeSuccessDialog,
} from '../components/ModelImportDialogs'
import { importSizeTier } from '../lib/importLimit'
import { useAppState } from '../context/AppState'

function ModelPanel() {
  const fileRef = useRef(null)
  const recommendationSeenRef = useRef(false)
  const [showRecommendation, setShowRecommendation] = useState(false)
  const [pendingLargeFile, setPendingLargeFile] = useState(null)

  const {
    menuOpen,
    setMenuOpen,
    unit,
    setUnit,
    target,
    setTarget,
    processMeshFile,
    importAlert,
    clearImportAlert,
    importOptimizeSuccess,
    dismissImportOptimizeSuccess,
    importReduceDialog,
    setImportReduceKeepRatio,
    applyImportReducePreview,
    acceptImportReducePreview,
    keepFullMeshOnImport,
    cancelImportReduce,
    handleResize,
    handleSettle,
    handleSimplify,
    handleExport,
    handleReset,
  } = useAppState()

  const openFilePicker = useCallback(() => {
    fileRef.current?.click()
  }, [])

  const beginImport = useCallback(() => {
    if (!recommendationSeenRef.current) {
      recommendationSeenRef.current = true
      setShowRecommendation(true)
      return
    }
    openFilePicker()
  }, [openFilePicker])

  const handleRecommendationContinue = useCallback(() => {
    setShowRecommendation(false)
    openFilePicker()
  }, [openFilePicker])

  const queueFileImport = useCallback((file) => {
    if (importSizeTier(file) === 'large') {
      setPendingLargeFile(file)
      return
    }
    processMeshFile(file)
  }, [processMeshFile])

  const handleFileSelected = useCallback((e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    queueFileImport(file)
  }, [queueFileImport])

  const handleLargeFileProceed = useCallback(() => {
    if (pendingLargeFile) processMeshFile(pendingLargeFile)
    setPendingLargeFile(null)
  }, [pendingLargeFile, processMeshFile])

  const handleLargeFileCancel = useCallback(() => {
    setPendingLargeFile(null)
  }, [])

  return (
    <>
      <ImportRecommendationDialog
        open={showRecommendation}
        onContinue={handleRecommendationContinue}
      />
      <LargeFileWarningDialog
        open={!!pendingLargeFile}
        file={pendingLargeFile}
        onCancel={handleLargeFileCancel}
        onProceed={handleLargeFileProceed}
      />
      <ImportMeshReduceDialog
        open={importReduceDialog.open}
        fileName={importReduceDialog.fileName}
        originalTriangles={importReduceDialog.originalTriangles}
        keepRatio={importReduceDialog.keepRatio}
        previewTriangles={importReduceDialog.previewTriangles}
        previewApplied={importReduceDialog.previewApplied}
        busy={importReduceDialog.applying}
        onKeepRatioChange={setImportReduceKeepRatio}
        onApplyPreview={applyImportReducePreview}
        onAcceptPreview={acceptImportReducePreview}
        onKeepFullMesh={keepFullMeshOnImport}
        onCancel={cancelImportReduce}
      />
      <OptimizeSuccessDialog
        open={importOptimizeSuccess.open}
        summary={importOptimizeSuccess}
        onDismiss={dismissImportOptimizeSuccess}
      />

      {menuOpen && <div className="backdrop" onClick={() => setMenuOpen(false)} />}
      <aside className={`control-panel${menuOpen ? ' open' : ''}`}>
        <button
          className="panel-close"
          type="button"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        >
          ✕
        </button>

        <section className="panel">
          <h2>Load model</h2>
          <p className="panel-hint">STL or 3MF up to 20 MB. Models over 10 MB show a performance warning; meshes above 50,000 triangles prompt you to choose how much detail to keep.</p>
          <input
            ref={fileRef}
            type="file"
            accept=".stl,.3mf,model/stl,model/3mf"
            hidden
            onChange={handleFileSelected}
          />
          <button type="button" className="import-browse-btn" onClick={beginImport}>
            Choose model file…
          </button>
          {importAlert && (
            <div className="import-alert" role="alert">
              <p>{importAlert}</p>
              <button type="button" onClick={clearImportAlert}>OK</button>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Resize</h2>
          <div className="unit-select">
            <label><input type="radio" checked={unit === 'mm'} onChange={() => setUnit('mm')} /> mm</label>
            <label><input type="radio" checked={unit === 'inch'} onChange={() => setUnit('inch')} /> inch</label>
          </div>
          <div className="inputs">
            <label>X <SmartNumberInput value={target.x} onChange={(x) => setTarget({ ...target, x })} /></label>
            <label>Y <SmartNumberInput value={target.y} onChange={(y) => setTarget({ ...target, y })} /></label>
            <label>Z <SmartNumberInput value={target.z} onChange={(z) => setTarget({ ...target, z })} /></label>
          </div>
          <button type="button" onClick={handleResize}>Apply Resize</button>
        </section>

        <section className="panel">
          <h2>Settle</h2>
          <p className="panel-hint">Drop model so the lowest point sits on the floor (Y=0).</p>
          <button type="button" onClick={handleSettle}>Settle</button>
        </section>

        <section className="panel">
          <h2>Simplify</h2>
          <button type="button" onClick={() => handleSimplify(0.75)}>75%</button>
          <button type="button" onClick={() => handleSimplify(0.5)}>50%</button>
          <button type="button" onClick={() => handleSimplify(0.25)}>25%</button>
        </section>

        <section className="panel">
          <h2>Actions</h2>
          <button type="button" onClick={handleExport}>Export STL</button>
          <button type="button" onClick={handleReset}>Reset</button>
        </section>

        <ProjectPanel />
      </aside>
    </>
  )
}

export default function ModelPage() {
  const {
    geometry,
    resetKey,
    status,
    viewerRef,
    stock,
    handleSettle,
    handleReset,
    handleCenter,
  } = useAppState()

  return (
    <>
      <ModelPanel />

      <main className="page-main">
        <div className="page-body">
          <div className="section-label">Page 1 — Model Import &amp; Editing</div>
          <div className="model-viewport-full">
            <Viewer3D
              ref={viewerRef}
              geometry={geometry}
              resetKey={resetKey}
              showModelBBox={stock.showModelBBox !== false}
              onSettle={handleSettle}
              onReset={handleReset}
              onCenter={handleCenter}
            />
          </div>
          {status && <div className="status-bar status-bar--above-nav">{status}</div>}
        </div>
        <PageNav page="model" />
      </main>
    </>
  )
}

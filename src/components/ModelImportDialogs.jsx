import React, { useMemo } from 'react'
import CenteredModalOverlay from './CenteredModalOverlay'
import {
  IMPORT_RECOMMENDATION_TEXT,
  TARGET_WORKING_TRIANGLES,
  formatFileSizeMiB,
} from '../lib/importLimit'
import {
  IMPORT_KEEP_RATIO_MIN,
  targetTrianglesFromKeepRatio,
} from '../lib/importPipeline'

export function ImportRecommendationDialog({ open, onContinue }) {
  return (
    <CenteredModalOverlay
      open={open}
      title="Import recommendation"
      ariaLabel="Import recommendation"
      onClose={onContinue}
    >
      <p className="import-dialog-body">{IMPORT_RECOMMENDATION_TEXT}</p>
      <div className="import-dialog-actions">
        <button type="button" className="import-dialog-primary" onClick={onContinue}>
          Continue
        </button>
      </div>
    </CenteredModalOverlay>
  )
}

export function LargeFileWarningDialog({ open, file, onCancel, onProceed }) {
  const sizeLabel = file ? formatFileSizeMiB(file.size) : ''
  return (
    <CenteredModalOverlay
      open={open}
      title="Large File Warning"
      ariaLabel="Large file warning"
      onClose={onCancel}
    >
      <p className="import-dialog-body import-dialog-body--lead">
        This file is over 10 MB{sizeLabel ? ` (${sizeLabel})` : ''}, which exceeds our standard recommendation for smooth performance.
      </p>
      <p className="import-dialog-body">
        We can attempt to reduce it to a safe working size (~5 MB), but the process is heavy and may crash your browser if system memory is low. If it crashes, simply refresh and try again.
      </p>
      <p className="import-dialog-body import-dialog-body--question">Would you like to proceed?</p>
      <div className="import-dialog-actions import-dialog-actions--split">
        <button type="button" className="import-dialog-primary" onClick={onProceed}>
          OK, Let&apos;s Try
        </button>
        <button type="button" className="import-dialog-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </CenteredModalOverlay>
  )
}

/**
 * Shown when an imported mesh exceeds the working triangle budget. User picks how much
 * detail to keep, previews in the viewport, and can re-apply with a different slider value.
 */
export function ImportMeshReduceDialog({
  open,
  fileName,
  originalTriangles,
  keepRatio,
  onKeepRatioChange,
  previewTriangles,
  previewApplied,
  busy,
  onApplyPreview,
  onAcceptPreview,
  onKeepFullMesh,
  onCancel,
}) {
  const targetTriangles = useMemo(
    () => targetTrianglesFromKeepRatio(originalTriangles, keepRatio),
    [originalTriangles, keepRatio],
  )
  const keepPct = Math.round(keepRatio * 100)

  return (
    <CenteredModalOverlay
      open={open}
      title="Reduce mesh for performance"
      ariaLabel="Reduce mesh for performance"
      onClose={busy ? undefined : onCancel}
    >
      <p className="import-dialog-body import-dialog-body--lead">
        {fileName ? `"${fileName}"` : 'This model'} has{' '}
        {originalTriangles.toLocaleString()} triangles — more than the recommended{' '}
        {TARGET_WORKING_TRIANGLES.toLocaleString()} for smooth toolpath work on typical PCs.
      </p>
      <p className="import-dialog-body">
        Choose how much detail to keep, then <strong>Preview reduction</strong> to update the 3D view.
        Move the slider and preview again if you want a different result.
      </p>

      <div className="import-reduce-slider">
        <label className="import-reduce-slider-label" htmlFor="import-keep-ratio">
          Keep detail: <span className="range-value">{keepPct}%</span>
        </label>
        <input
          id="import-keep-ratio"
          type="range"
          min={IMPORT_KEEP_RATIO_MIN * 100}
          max={100}
          step={5}
          value={keepPct}
          disabled={busy}
          onChange={(e) => onKeepRatioChange(Number(e.target.value) / 100)}
        />
        <p className="import-reduce-stats">
          Target about {targetTriangles.toLocaleString()} triangles
          {previewApplied && previewTriangles != null && (
            <>
              {' '}
              · Last preview: {previewTriangles.toLocaleString()} triangles
              {previewTriangles < targetTriangles * 0.85 && (
                <span className="import-reduce-stats-note">
                  {' '}
                  (actual count can be lower than the slider target on curved meshes)
                </span>
              )}
            </>
          )}
        </p>
      </div>

      <div className="import-dialog-actions import-dialog-actions--stack">
        <button
          type="button"
          className="import-dialog-primary"
          disabled={busy}
          onClick={onApplyPreview}
        >
          {busy ? 'Reducing…' : previewApplied ? 'Preview again' : 'Preview reduction'}
        </button>
        {previewApplied && (
          <button
            type="button"
            className="import-dialog-primary import-dialog-primary--accept"
            disabled={busy}
            onClick={onAcceptPreview}
          >
            Use this mesh
          </button>
        )}
        <div className="import-dialog-actions import-dialog-actions--split">
          <button
            type="button"
            className="import-dialog-secondary"
            disabled={busy}
            onClick={onKeepFullMesh}
          >
            Keep full mesh
          </button>
          <button type="button" className="import-dialog-secondary" disabled={busy} onClick={onCancel}>
            Cancel import
          </button>
        </div>
      </div>
    </CenteredModalOverlay>
  )
}

export function OptimizeSuccessDialog({ open, summary, onDismiss }) {
  const detail = summary?.simplified
    ? ` (${summary.originalTriangles.toLocaleString()} → ${summary.newTriangles.toLocaleString()} triangles)`
    : ''
  return (
    <CenteredModalOverlay
      open={open}
      title="Mesh ready"
      ariaLabel="Mesh ready"
      onClose={onDismiss}
    >
      <p className="import-dialog-body">
        Your model is ready for toolpath generation{detail}.
        {summary?.simplified
          ? ' You chose the reduction level during import.'
          : ''}
      </p>
      <div className="import-dialog-actions">
        <button type="button" className="import-dialog-primary" onClick={onDismiss}>
          OK / Start Designing
        </button>
      </div>
    </CenteredModalOverlay>
  )
}

import React from 'react'
import CenteredModalOverlay from './CenteredModalOverlay'
import {
  IMPORT_RECOMMENDATION_TEXT,
  formatFileSizeMiB,
} from '../lib/importLimit'

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

export function OptimizeSuccessDialog({ open, summary, onDismiss }) {
  const detail = summary?.simplified
    ? ` (${summary.originalTriangles.toLocaleString()} → ${summary.newTriangles.toLocaleString()} triangles)`
    : ''
  return (
    <CenteredModalOverlay
      open={open}
      title="Smart Optimization Applied"
      ariaLabel="Smart optimization applied"
      onClose={onDismiss}
    >
      <p className="import-dialog-body">
        Your model has been automatically streamlined{detail} to ensure fast slicing and smooth operation on your PC. Ready for toolpath generation!
      </p>
      <div className="import-dialog-actions">
        <button type="button" className="import-dialog-primary" onClick={onDismiss}>
          OK / Start Designing
        </button>
      </div>
    </CenteredModalOverlay>
  )
}

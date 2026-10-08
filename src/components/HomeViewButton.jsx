import React from 'react'

/** Reset camera to the default framed home view (replaces the ViewCube widget). */
export default function HomeViewButton({ onClick }) {
  return (
    <button
      type="button"
      className="viewport-home-btn"
      title="Reset to home view"
      aria-label="Reset to home view"
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
        <path d="M12 3l9 8h-3v9h-4v-6h-4v6H6v-9H3z" />
      </svg>
    </button>
  )
}

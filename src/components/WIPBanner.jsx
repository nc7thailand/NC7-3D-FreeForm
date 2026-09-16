import React from 'react'

/**
 * Work-in-progress banner — pinned to the top of the app so anyone viewing a
 * deployed or shared build sees at a glance that the software is not finished.
 */
export default function WIPBanner() {
  return (
    <div className="wip-banner" role="note">
      <span className="wip-banner-text">
        Work in progress — preview build only, not for production use
      </span>
    </div>
  )
}

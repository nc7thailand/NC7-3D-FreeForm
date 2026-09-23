// Detect how the current document was loaded (fresh navigation vs reload).
// Read once at module init — Navigation Timing entries are stable for the
// lifetime of the page.

export const NAV_LOAD_KIND = {
  INITIAL: 'initial',
  RELOAD: 'reload',
  BACK_FORWARD: 'back_forward',
  PRERENDER: 'prerender',
  UNKNOWN: 'unknown',
}

const SESSION_TOOLPATH_AUTO_SETUP_KEY = 'nc7:toolpath-auto-setup-shown'
const SESSION_TOOLPATH_VIEW_KEY = 'nc7:toolpath-view-mode'
const SESSION_TOOLPATH_LO_KEY = 'nc7:toolpath-lo-display'

function readNavigationLoadKind() {
  if (typeof performance === 'undefined') return NAV_LOAD_KIND.UNKNOWN

  const entries = performance.getEntriesByType?.('navigation')
  if (entries?.length) {
    const type = entries[0].type
    if (type === 'reload') return NAV_LOAD_KIND.RELOAD
    if (type === 'back_forward') return NAV_LOAD_KIND.BACK_FORWARD
    if (type === 'prerender') return NAV_LOAD_KIND.PRERENDER
    if (type === 'navigate') return NAV_LOAD_KIND.INITIAL
  }

  const nav = performance.navigation
  if (nav) {
    if (nav.type === nav.TYPE_RELOAD) return NAV_LOAD_KIND.RELOAD
    if (nav.type === nav.TYPE_BACK_FORWARD) return NAV_LOAD_KIND.BACK_FORWARD
    if (nav.type === nav.TYPE_NAVIGATE) return NAV_LOAD_KIND.INITIAL
  }

  return NAV_LOAD_KIND.UNKNOWN
}

/** Cached load kind for this document (stable until the tab is closed). */
export const navigationLoadKind = readNavigationLoadKind()

/** True when the user refreshed the page (F5, reload button, location.reload). */
export function isPageReload() {
  return navigationLoadKind === NAV_LOAD_KIND.RELOAD
}

/** True on a normal first navigation into the app (not refresh, not back/forward). */
export function isInitialDocumentLoad() {
  return navigationLoadKind === NAV_LOAD_KIND.INITIAL
    || navigationLoadKind === NAV_LOAD_KIND.PRERENDER
    || navigationLoadKind === NAV_LOAD_KIND.UNKNOWN
}

/**
 * Whether the Toolpath Setup panel may auto-open on route entry.
 * Allowed only on the first Toolpath visit in this tab session, and never
 * after a page reload.
 */
export function shouldAutoOpenToolpathSetup() {
  if (isPageReload()) return false
  if (typeof window === 'undefined' || !window.sessionStorage) return false
  return !window.sessionStorage.getItem(SESSION_TOOLPATH_AUTO_SETUP_KEY)
}

/** Mark that the one-time auto-open for Toolpath has been consumed. */
export function markToolpathAutoSetupShown() {
  if (typeof window === 'undefined' || !window.sessionStorage) return
  window.sessionStorage.setItem(SESSION_TOOLPATH_AUTO_SETUP_KEY, '1')
}

/** Restore toolpath view mode (3d / 2d) across reloads within a tab. Default 2D. */
export function loadToolpathViewMode() {
  if (typeof window === 'undefined' || !window.sessionStorage) return '2d'
  const v = window.sessionStorage.getItem(SESSION_TOOLPATH_VIEW_KEY)
  if (v === '3d' || v === 'combined') return '3d'
  return '2d'
}

export function saveToolpathViewMode(mode) {
  if (typeof window === 'undefined' || !window.sessionStorage) return
  const stored = mode === '3d' || mode === 'combined' ? '3d' : '2d'
  window.sessionStorage.setItem(SESSION_TOOLPATH_VIEW_KEY, stored)
}

/** Lo 3D display shell — default on (low-poly). */
export function loadToolpathLoDisplay() {
  if (typeof window === 'undefined' || !window.sessionStorage) return true
  const v = window.sessionStorage.getItem(SESSION_TOOLPATH_LO_KEY)
  if (v === '0') return false
  if (v === '1') return true
  return true
}

export function saveToolpathLoDisplay(active) {
  if (typeof window === 'undefined' || !window.sessionStorage) return
  window.sessionStorage.setItem(SESSION_TOOLPATH_LO_KEY, active ? '1' : '0')
}

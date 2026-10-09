/** 3D viewport mesh shell — does not affect toolpath compute (always hi-res). */
export const VIEW_RES_HI = 'hi'
export const VIEW_RES_LO = 'lo'

const LS_MODE = 'nc7:toolpath-view-res'
const LS_REMEMBER = 'nc7:toolpath-view-res-remember'
const SS_MODE = 'nc7:toolpath-view-res-session'

/**
 * @returns {{ mode: 'hi'|'lo', prompt: boolean }}
 */
export function readToolpathViewResolution() {
  try {
    if (localStorage.getItem(LS_REMEMBER) === '1') {
      const mode = localStorage.getItem(LS_MODE)
      if (mode === VIEW_RES_HI || mode === VIEW_RES_LO) {
        return { mode, prompt: false }
      }
    }
    const session = sessionStorage.getItem(SS_MODE)
    if (session === VIEW_RES_HI || session === VIEW_RES_LO) {
      return { mode: session, prompt: false }
    }
  } catch {
    /* private browsing */
  }
  return { mode: VIEW_RES_LO, prompt: true }
}

export function isViewResolutionRemembered() {
  try {
    return localStorage.getItem(LS_REMEMBER) === '1'
  } catch {
    return false
  }
}

/**
 * @param {'hi'|'lo'} mode
 * @param {boolean} remember
 */
export function writeToolpathViewResolution(mode, remember) {
  try {
    if (remember) {
      localStorage.setItem(LS_MODE, mode)
      localStorage.setItem(LS_REMEMBER, '1')
      sessionStorage.removeItem(SS_MODE)
    } else {
      sessionStorage.setItem(SS_MODE, mode)
      localStorage.removeItem(LS_REMEMBER)
      localStorage.removeItem(LS_MODE)
    }
  } catch {
    /* ignore */
  }
}

/** @param {'hi'|'lo'} mode */
export function displayProxyForViewResolution(mode) {
  return mode === VIEW_RES_LO
}

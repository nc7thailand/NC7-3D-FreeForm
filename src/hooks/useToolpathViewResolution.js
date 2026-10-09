import { useCallback, useState } from 'react'
import {
  VIEW_RES_HI,
  VIEW_RES_LO,
  displayProxyForViewResolution,
  isViewResolutionRemembered,
  readToolpathViewResolution,
  writeToolpathViewResolution,
} from '../lib/toolpathViewResolution'

export function useToolpathViewResolution() {
  const initial = readToolpathViewResolution()
  const [mode, setMode] = useState(initial.mode)
  const [modalOpen, setModalOpen] = useState(false)
  const [remember, setRemember] = useState(true)
  const [chosen, setChosen] = useState(!initial.prompt)

  const openPromptIfNeeded = useCallback(() => {
    const current = readToolpathViewResolution()
    if (current.prompt) {
      setModalOpen(true)
      setChosen(false)
      return false
    }
    setMode(current.mode)
    setChosen(true)
    return true
  }, [])

  const choose = useCallback((nextMode) => {
    writeToolpathViewResolution(nextMode, remember)
    setMode(nextMode)
    setModalOpen(false)
    setChosen(true)
  }, [remember])

  const toggleHiLo = useCallback(() => {
    const next = mode === VIEW_RES_HI ? VIEW_RES_LO : VIEW_RES_HI
    writeToolpathViewResolution(next, isViewResolutionRemembered())
    setMode(next)
    setChosen(true)
    setModalOpen(false)
  }, [mode])

  /** Re-open the Hi/Lo resolution picker (HUD ? button). */
  const openResolutionModal = useCallback(() => {
    setRemember(isViewResolutionRemembered() || remember)
    setModalOpen(true)
  }, [remember])

  return {
    mode,
    isHi: mode === VIEW_RES_HI,
    displayProxy: displayProxyForViewResolution(mode),
    modalOpen,
    remember,
    setRemember,
    chosen,
    choose,
    toggleHiLo,
    openPromptIfNeeded,
    openResolutionModal,
    setModalOpen,
    VIEW_RES_HI,
    VIEW_RES_LO,
  }
}

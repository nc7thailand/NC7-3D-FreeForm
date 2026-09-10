import React from 'react'
import { Outlet } from 'react-router-dom'
import Stepper from './Stepper'
import { useAppState } from '../context/AppState'

export default function AppLayout() {
  const { menuOpen, setMenuOpen } = useAppState()

  return (
    <div className="app">
      <header className="header header--combined">
        <div className="header-brand">
          <button
            className="menu-toggle"
            type="button"
            aria-label="Toggle menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="menu-bar" />
            <span className="menu-bar" />
            <span className="menu-bar" />
          </button>
          <div className="header-text">
            <h1>NC7 Studio3D CAM</h1>
            <p>Hot wire foam cutter — Model · Toolpath · G-code</p>
          </div>
        </div>
        <Stepper />
      </header>

      <div className="content">
        <Outlet />
      </div>
    </div>
  )
}

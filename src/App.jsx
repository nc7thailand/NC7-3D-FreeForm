import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppStateProvider } from './context/AppState'
import AppLayout from './components/AppLayout'
import WIPBanner from './components/WIPBanner'
import { RequireModel, RequireToolpath } from './components/RouteGuards'
import { ROUTES } from './routes'
import ModelPage from './pages/ModelPage'
import ToolpathPage from './pages/ToolpathPage'
import GcodePage from './pages/GcodePage'
import SimulatePage from './pages/SimulatePage'
import './index.css'

export default function App() {
  return (
    <AppStateProvider>
      <WIPBanner />
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Navigate to={ROUTES.model} replace />} />
            <Route path={ROUTES.model} element={<ModelPage />} />
            <Route
              path={ROUTES.toolpath}
              element={(
                <RequireModel>
                  <ToolpathPage />
                </RequireModel>
              )}
            />
            <Route
              path={ROUTES.gcode}
              element={(
                <RequireToolpath>
                  <GcodePage />
                </RequireToolpath>
              )}
            />
            <Route
              path={ROUTES.simulate}
              element={(
                <RequireToolpath>
                  <SimulatePage />
                </RequireToolpath>
              )}
            />
            <Route path="*" element={<Navigate to={ROUTES.model} replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppStateProvider>
  )
}

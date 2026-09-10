import React, { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { PROJECT_EXTENSION } from '../lib/project'
import { useAppState } from '../context/AppState'

export default function ProjectPanel() {
  const navigate = useNavigate()
  const fileRef = useRef(null)
  const { handleSaveProject, handleOpenProject } = useAppState()

  const onOpenSelected = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const result = await handleOpenProject(file)
    if (result?.route) navigate(result.route)
  }

  return (
    <section className="panel panel-project">
      <h2>Project</h2>
      <p className="panel-hint">
        Save or open a {PROJECT_EXTENSION} file (model + foam block + toolpath).
      </p>
      <div className="project-actions">
        <button type="button" onClick={handleSaveProject}>Save Project</button>
        <button type="button" onClick={() => fileRef.current?.click()}>Open Project</button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={PROJECT_EXTENSION}
        hidden
        onChange={onOpenSelected}
      />
    </section>
  )
}

import { packProject, unpackProjectBuffer } from './project.js'

const DB_NAME = 'nc7-studio3d'
const STORE = 'session'
const KEY = 'autosave'

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open session storage.'))
  })
}

async function idbPut(buffer) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(buffer, KEY)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error ?? new Error('Failed to save session.'))
    }
  })
}

async function idbGet() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(KEY)
    req.onsuccess = () => {
      db.close()
      resolve(req.result ?? null)
    }
    req.onerror = () => {
      db.close()
      reject(req.error ?? new Error('Failed to load session.'))
    }
  })
}

async function idbClear() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(KEY)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error ?? new Error('Failed to clear session.'))
    }
  })
}

/** Persist current CAM state to IndexedDB (survives page refresh). */
export async function saveBrowserSession(params) {
  const blob = await packProject(params)
  await idbPut(await blob.arrayBuffer())
}

/** Restore CAM state from IndexedDB, or null when nothing is saved. */
export async function loadBrowserSession() {
  const buffer = await idbGet()
  if (!buffer) return null
  return unpackProjectBuffer(buffer)
}

/** Remove autosaved session (e.g. on explicit reset). */
export async function clearBrowserSession() {
  await idbClear()
}

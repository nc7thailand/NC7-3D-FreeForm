import * as THREE from 'three'
import { bumpModelRevision } from './toolpathCompute.js'
import { createSceneObject, nextPartName, pickPartColor } from './sceneObjects.js'
import { defaultSplitPlaneForGeometry, splitGeometryBoth, splitGeometryByPlane } from './planeSplit.js'

export function findSceneObject(objects, id) {
  return objects.find((o) => o.id === id) ?? null
}

export function usedPartColors(objects) {
  return objects.map((o) => o.color)
}

/** Apply selection to working geometry refs. */
export function geometryForSelection(objects, selectedId) {
  const obj = findSceneObject(objects, selectedId) ?? objects[0] ?? null
  return obj?.geometry ?? null
}

export function initSceneFromGeometry(geometry, name = 'part') {
  const obj = createSceneObject(geometry, { name, type: 'artwork' })
  return { objects: [obj], selectedId: obj.id, toolpathId: obj.id }
}

export function computeSplitPlane(geometry, offsetY = 0) {
  const base = defaultSplitPlaneForGeometry(geometry)
  base.point.y += offsetY
  return base
}

function prepareSplitGeometry(geometry) {
  geometry.userData.nc7CentroidApplied = true
  bumpModelRevision(geometry)
  return geometry
}

function validSplitGeo(geo) {
  return geo?.attributes?.position?.count >= 3
}

/**
 * Split the selected object and update the scene object list.
 *
 * @param {object[]} objects
 * @param {string} selectedId
 * @param {'top'|'bottom'|'both'} keep
 * @param {{ point: THREE.Vector3, normal: THREE.Vector3 }} plane
 */
export function splitSceneObject(objects, selectedId, keep, plane) {
  const target = findSceneObject(objects, selectedId)
  if (!target?.geometry) return null

  const colors = usedPartColors(objects)
  const remaining = objects.filter((o) => o.id !== selectedId)
  const baseName = target.name.replace(/-(top|bottom|[a-z])$/i, '') || 'part'

  if (keep === 'top') {
    const geo = splitGeometryByPlane(target.geometry, { ...plane, side: 'positive' })
    if (!validSplitGeo(geo)) return { error: 'No geometry on the top side of the plane.' }
    target.geometry.dispose()
    const next = createSceneObject(prepareSplitGeometry(geo), {
      name: `${baseName}-top`,
      type: 'artwork',
      color: target.color,
      id: target.id,
    })
    return { objects: [...remaining, next], selectedId: next.id, toolpathId: next.id }
  }

  if (keep === 'bottom') {
    const geo = splitGeometryByPlane(target.geometry, { ...plane, side: 'negative' })
    if (!validSplitGeo(geo)) return { error: 'No geometry on the bottom side of the plane.' }
    target.geometry.dispose()
    const next = createSceneObject(prepareSplitGeometry(geo), {
      name: `${baseName}-bottom`,
      type: 'artwork',
      color: target.color,
      id: target.id,
    })
    return { objects: [...remaining, next], selectedId: next.id, toolpathId: next.id }
  }

  const { positive, negative } = splitGeometryBoth(target.geometry, plane)
  if (!validSplitGeo(positive) || !validSplitGeo(negative)) {
    return { error: 'Split produced an empty part — adjust the plane.' }
  }
  target.geometry.dispose()
  const top = createSceneObject(prepareSplitGeometry(positive), {
    name: `${baseName}-a`,
    type: 'artwork',
    color: pickPartColor(colors),
  })
  const bottom = createSceneObject(prepareSplitGeometry(negative), {
    name: `${baseName}-b`,
    type: 'artwork',
    color: pickPartColor([...colors, top.color]),
  })
  return {
    objects: [...remaining, top, bottom],
    selectedId: top.id,
    toolpathId: top.id,
  }
}

export function addHelperObject(objects, parentId, geometry, { type, name }) {
  const parent = findSceneObject(objects, parentId)
  if (!parent) return null
  const helper = createSceneObject(geometry, {
    name: name ?? type,
    type,
    color: pickPartColor(usedPartColors(objects)),
    parentId,
    includeInCut: true,
  })
  return { objects: [...objects, helper], helperId: helper.id }
}

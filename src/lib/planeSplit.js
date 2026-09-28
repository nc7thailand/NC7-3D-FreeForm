// Plane mesh split — clip triangles to a half-space without CSG merge.
// World vertex positions are preserved (design D4: maintain world positions).

import * as THREE from 'three'

const EPS = 1e-6

function signedDistance(p, planePoint, planeNormal) {
  return (p.x - planePoint.x) * planeNormal.x
    + (p.y - planePoint.y) * planeNormal.y
    + (p.z - planePoint.z) * planeNormal.z
}

function lerpVertex(a, b, t, out = new THREE.Vector3()) {
  return out.set(
    a.x + t * (b.x - a.x),
    a.y + t * (b.y - a.y),
    a.z + t * (b.z - a.z),
  )
}

function clipPolygonToHalfSpace(vertices, planePoint, planeNormal, keepPositive) {
  if (!vertices.length) return []
  const out = []
  for (let i = 0; i < vertices.length; i++) {
    const curr = vertices[i]
    const prev = vertices[(i + vertices.length - 1) % vertices.length]
    const dCurr = signedDistance(curr, planePoint, planeNormal)
    const dPrev = signedDistance(prev, planePoint, planeNormal)
    const currInside = keepPositive ? dCurr >= -EPS : dCurr <= EPS
    const prevInside = keepPositive ? dPrev >= -EPS : dPrev <= EPS

    if (currInside) {
      if (!prevInside) {
        const t = dPrev / (dPrev - dCurr)
        out.push(lerpVertex(prev, curr, t, new THREE.Vector3()))
      }
      out.push(curr.clone())
    } else if (prevInside) {
      const t = dPrev / (dPrev - dCurr)
      out.push(lerpVertex(prev, curr, t, new THREE.Vector3()))
    }
  }
  return out
}

function triangulateFan(polygon) {
  if (polygon.length < 3) return []
  const tris = []
  const v0 = polygon[0]
  for (let i = 1; i < polygon.length - 1; i++) {
    tris.push([v0, polygon[i], polygon[i + 1]])
  }
  return tris
}

function clipTriangleToHalfSpace(v0, v1, v2, planePoint, planeNormal, keepPositive) {
  const poly = clipPolygonToHalfSpace([v0, v1, v2], planePoint, planeNormal, keepPositive)
  return triangulateFan(poly)
}

function trianglesFromGeometry(geometry) {
  const g = geometry.index ? geometry.clone().toNonIndexed() : geometry.clone()
  const pos = g.attributes.position.array
  const tris = []
  for (let i = 0; i < pos.length; i += 9) {
    tris.push([
      new THREE.Vector3(pos[i], pos[i + 1], pos[i + 2]),
      new THREE.Vector3(pos[i + 3], pos[i + 4], pos[i + 5]),
      new THREE.Vector3(pos[i + 6], pos[i + 7], pos[i + 8]),
    ])
  }
  g.dispose()
  return tris
}

function buildGeometryFromTriangles(tris) {
  if (!tris.length) return null
  const positions = new Float32Array(tris.length * 9)
  let o = 0
  for (const [a, b, c] of tris) {
    positions[o++] = a.x; positions[o++] = a.y; positions[o++] = a.z
    positions[o++] = b.x; positions[o++] = b.y; positions[o++] = b.z
    positions[o++] = c.x; positions[o++] = c.y; positions[o++] = c.z
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  geo.computeBoundingBox()
  return geo
}

function normalizePlane({ point, normal }) {
  const planePoint = point instanceof THREE.Vector3
    ? point.clone()
    : new THREE.Vector3(point.x ?? point[0] ?? 0, point.y ?? point[1] ?? 0, point.z ?? point[2] ?? 0)
  const planeNormal = normal instanceof THREE.Vector3
    ? normal.clone().normalize()
    : new THREE.Vector3(normal.x ?? normal[0] ?? 0, normal.y ?? normal[1] ?? 1, normal.z ?? normal[2] ?? 0).normalize()
  return { planePoint, planeNormal }
}

/**
 * Clip mesh to one half-space. side='positive' keeps vertices on the normal side.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {{ point: THREE.Vector3|object, normal: THREE.Vector3|object, side?: 'positive'|'negative' }} plane
 */
export function splitGeometryByPlane(geometry, plane) {
  const { planePoint, planeNormal } = normalizePlane(plane)
  const keepPositive = plane.side !== 'negative'
  const tris = trianglesFromGeometry(geometry)
  const out = []
  for (const [v0, v1, v2] of tris) {
    out.push(...clipTriangleToHalfSpace(v0, v1, v2, planePoint, planeNormal, keepPositive))
  }
  return buildGeometryFromTriangles(out)
}

/** Split into both halves — world positions unchanged. */
export function splitGeometryBoth(geometry, plane) {
  const base = normalizePlane(plane)
  return {
    positive: splitGeometryByPlane(geometry, { ...base, side: 'positive' }),
    negative: splitGeometryByPlane(geometry, { ...base, side: 'negative' }),
  }
}

/** Default horizontal split plane through the geometry bbox centre. */
export function defaultSplitPlaneForGeometry(geometry) {
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  const center = bb.getCenter(new THREE.Vector3())
  return {
    point: center,
    normal: new THREE.Vector3(0, 1, 0),
  }
}

// Demo model generators — produce in-memory BufferGeometries so the slicing /
// toolpath preview can be tested without hunting for a real .stl file.
// Everything is generated in millimetres, sitting with its base on Y = 0.

import * as THREE from 'three'

/**
 * UV-sphere with the given centre & radius (triangle soup).
 *
 * @param {{ x?: number, y?: number, z?: number }} [center]
 * @param {number} [radius]
 * @param {number} [widthSegments]
 * @param {number} [heightSegments]
 * @returns {THREE.BufferGeometry}
 */
export function makeSphereGeometry(
  { x = 0, y = 0, z = 0 } = {},
  radius = 25,
  widthSegments = 48,
  heightSegments = 24
) {
  const geo = new THREE.BufferGeometry()
  const pos = []
  const idx = []

  for (let iy = 0; iy <= heightSegments; iy++) {
    const v = iy / heightSegments
    const phi = v * Math.PI // 0..π polar from top
    for (let ix = 0; ix <= widthSegments; ix++) {
      const u = ix / widthSegments
      const theta = u * Math.PI * 2
      const px = x + radius * Math.sin(phi) * Math.cos(theta)
      const py = y + radius * Math.cos(phi)
      const pz = z + radius * Math.sin(phi) * Math.sin(theta)
      pos.push(px, py, pz)
    }
  }

  const row = widthSegments + 1
  for (let iy = 0; iy < heightSegments; iy++) {
    for (let ix = 0; ix < widthSegments; ix++) {
      const a = iy * row + ix
      const b = a + 1
      const c = a + row
      const d = c + 1
      idx.push(a, c, b, b, c, d)
    }
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  geo.computeBoundingBox()
  return geo
}

/**
 * "Turning demo" part — a solid of revolution (e.g. a rocket/spindle profile)
 * spun around the Y axis. Its vertical cross-section shows the classic turned
 * outline, which is exactly the toolpath shape the hot-wire rotary axis cuts.
 *
 * @param {Array<[number, number]>} profile - [radius, y] pairs, bottom -> top
 * @param {number} [segments]
 * @returns {THREE.BufferGeometry}
 */
export function makeLatheGeometry(profile, segments = 64) {
  const geo = new THREE.BufferGeometry()
  const pos = []
  const idx = []

  const rows = profile.length
  for (let r = 0; r < rows; r++) {
    const [rad, y] = profile[r]
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2
      pos.push(rad * Math.cos(a), y, rad * Math.sin(a))
    }
  }

  const col = segments + 1
  for (let r = 0; r < rows - 1; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * col + s
      const b = a + 1
      const c = (r + 1) * col + s
      const d = c + 1
      idx.push(a, c, b, b, c, d)
    }
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  geo.computeBoundingBox()
  return geo
}

/**
 * Convenient pre-built demo parts.
 */
export const DEMO_MODELS = {
  /**
   * Sphere centred on the Y axis, resting on Y = 0. Rotational symmetry makes
   * every θ slice identical — good baseline check of the slicer.
   */
  sphere: {
    label: 'Sphere (demo)',
    make: () => {
      const radius = 25
      const geo = makeSphereGeometry({ x: 0, y: radius, z: 0 }, radius)
      return geo
    },
  },

  /**
   * Sphere pushed off the rotation axis ("eccentric bump") — slice profiles
   * change as θ rotates, ideal for verifying the plane rotation math.
   */
  eccentric: {
    label: 'Eccentric sphere (demo)',
    make: () => {
      const radius = 25
      const geo = makeSphereGeometry({ x: 18, y: radius, z: 0 }, radius)
      // Shift X centre so it still sits over the axis roughly (bump outward)
      geo.translate(-9, 0, 0)
      geo.computeBoundingBox()
      return geo
    },
  },

  /**
   * Spindle / "turned" part generated from a radius profile.
   */
  spindle: {
    label: 'Spindle / lathe (demo)',
    make: () => {
      const geo = makeLatheGeometry(
        [
          [6, 0],
          [6, 10],
          [20, 20],
          [14, 30],
          [22, 45],
          [22, 55],
          [10, 70],
          [10, 85],
          [4, 95],
          [4, 100],
        ],
        96
      )
      // Center the stock horizontally about the axis
      geo.computeBoundingBox()
      const box = geo.boundingBox
      geo.translate(-(box.min.x + box.max.x) / 2, 0, -(box.min.z + box.max.z) / 2)
      geo.computeBoundingBox()
      return geo
    },
  },
}

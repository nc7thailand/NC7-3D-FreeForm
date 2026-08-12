// Resize / scaling utilities for STL geometry

import * as THREE from 'three'

/**
 * Unit conversion constants: inches to mm.
 * The model is treated as millimeters internally (STL is unitless).
 */
export const INCH_TO_MM = 25.4

/**
 * Compute the target size in mm based on unit selection.
 *
 * @param {{x: number, y: number, z: number}} target
 * @param {'mm' | 'inch'} unit
 * @returns {{x: number, y: number, z: number}} target in mm
 */
export function resolveTargetMM(target, unit) {
  if (unit === 'inch') {
    return {
      x: target.x * INCH_TO_MM,
      y: target.y * INCH_TO_MM,
      z: target.z * INCH_TO_MM
    }
  }
  return target
}

/**
 * Compute a uniform scale factor such that all dimensions fit within
 * the given maximum target dimensions (fit-to-bounds).
 *
 * @param {{x: number, y: number, z: number}} current - current size in mm
 * @param {{x: number, y: number, z: number}} targetMM - target max size in mm
 * @returns {number} uniform scale factor
 */
export function computeFitScale(current, targetMM) {
  if (!current.x || !current.y || !current.z) return 1
  const sx = targetMM.x / current.x
  const sy = targetMM.y / current.y
  const sz = targetMM.z / current.z
  // Use the smallest factor so the model never exceeds any bound
  return Math.min(sx, sy, sz)
}

/**
 * Scale a BufferGeometry by a uniform factor.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {number} factor
 * @returns {THREE.BufferGeometry} the same (mutated) geometry
 */
export function scaleGeometry(geometry, factor) {
  if (factor === 1) return geometry
  geometry.scale(factor, factor, factor)
  geometry.computeBoundingBox()
  return geometry
}

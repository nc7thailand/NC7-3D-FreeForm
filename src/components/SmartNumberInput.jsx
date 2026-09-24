import React, { useCallback, useEffect, useRef, useState } from 'react'
import { debounce } from '../lib/debounce'

/**
 * Standard numeric input for NC7 — mandatory pattern for all number fields.
 *
 * Rest: shows 0 when value is 0.
 * Focus: clears the field when value is 0; keeps non-zero values visible.
 * Blur: empty input falls back to `emptyFallback` (default 0).
 *
 * @param {number} [debounceMs=0] delay before `onChange` fires while typing
 */
export default function SmartNumberInput({
  value,
  onChange,
  emptyFallback = 0,
  min,
  max,
  step,
  className,
  debounceMs = 0,
  onFocus,
  onBlur,
  ...rest
}) {
  const numericValue = Number(value)
  const safeValue = Number.isFinite(numericValue) ? numericValue : emptyFallback

  const [focused, setFocused] = useState(false)
  const [text, setText] = useState('')

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const debouncedOnChangeRef = useRef(null)
  if (!debouncedOnChangeRef.current) {
    debouncedOnChangeRef.current = debounceMs > 0
      ? debounce((n) => onChangeRef.current(n), debounceMs)
      : null
  }

  useEffect(() => {
    if (debounceMs > 0) {
      debouncedOnChangeRef.current?.cancel()
      debouncedOnChangeRef.current = debounce((n) => onChangeRef.current(n), debounceMs)
    } else {
      debouncedOnChangeRef.current = null
    }
  }, [debounceMs])

  useEffect(() => () => {
    debouncedOnChangeRef.current?.cancel()
  }, [])

  const emitChange = useCallback((n) => {
    if (debouncedOnChangeRef.current) {
      debouncedOnChangeRef.current(n)
    } else {
      onChangeRef.current(n)
    }
  }, [])

  useEffect(() => {
    if (!focused) {
      setText(String(safeValue))
    }
  }, [safeValue, focused])

  const clamp = useCallback((n) => {
    let out = n
    if (min != null) out = Math.max(min, out)
    if (max != null) out = Math.min(max, out)
    return out
  }, [min, max])

  const commit = useCallback((raw) => {
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed === '-' || trimmed === '+') {
      debouncedOnChangeRef.current?.cancel()
      onChangeRef.current(emptyFallback)
      setText(String(emptyFallback))
      return
    }
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      debouncedOnChangeRef.current?.cancel()
      onChangeRef.current(emptyFallback)
      setText(String(emptyFallback))
      return
    }
    const next = clamp(parsed)
    debouncedOnChangeRef.current?.cancel()
    onChangeRef.current(next)
    setText(String(next))
  }, [clamp, emptyFallback])

  const handleFocus = (e) => {
    setFocused(true)
    setText(safeValue === 0 ? '' : String(safeValue))
    onFocus?.(e)
  }

  const handleChange = (e) => {
    const nextText = e.target.value
    setText(nextText)
    const trimmed = nextText.trim()
    if (trimmed === '' || trimmed === '-' || trimmed === '+') return
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed)) {
      emitChange(clamp(parsed))
    }
  }

  const handleBlur = (e) => {
    setFocused(false)
    debouncedOnChangeRef.current?.flush()
    commit(text)
    onBlur?.(e)
  }

  return (
    <input
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      className={className}
      value={focused ? text : String(safeValue)}
      onFocus={handleFocus}
      onChange={handleChange}
      onBlur={handleBlur}
      {...rest}
    />
  )
}

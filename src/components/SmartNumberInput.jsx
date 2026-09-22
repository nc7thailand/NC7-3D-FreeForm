import React, { useCallback, useEffect, useState } from 'react'

/**
 * Standard numeric input for NC7 — mandatory pattern for all number fields.
 *
 * Rest: shows 0 when value is 0.
 * Focus: clears the field when value is 0; keeps non-zero values visible.
 * Blur: empty input falls back to `emptyFallback` (default 0).
 */
export default function SmartNumberInput({
  value,
  onChange,
  emptyFallback = 0,
  min,
  max,
  step,
  className,
  onFocus,
  onBlur,
  ...rest
}) {
  const numericValue = Number(value)
  const safeValue = Number.isFinite(numericValue) ? numericValue : emptyFallback

  const [focused, setFocused] = useState(false)
  const [text, setText] = useState('')

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
      onChange(emptyFallback)
      setText(String(emptyFallback))
      return
    }
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      onChange(emptyFallback)
      setText(String(emptyFallback))
      return
    }
    const next = clamp(parsed)
    onChange(next)
    setText(String(next))
  }, [clamp, emptyFallback, onChange])

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
      onChange(clamp(parsed))
    }
  }

  const handleBlur = (e) => {
    setFocused(false)
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

/**
 * Shared numeric text input with cursor-position-aware scroll increment (Feature 23G).
 *
 * Scrolling up/down increments or decrements the digit to the immediately left
 * of the blinking cursor. Example: cursor after "1.2" → tenths place → step ±0.1.
 *
 * Uses type="text" (not type="number") so selectionStart is available in all browsers.
 */
import React, { useRef, useState, useEffect } from 'react';

// ── Scroll increment helper ───────────────────────────────────────────────────

/**
 * Given a numeric string and a cursor position, return the place value of the
 * digit immediately to the left of the cursor.
 *
 * Examples (| marks cursor):
 *   "1.2|"   → 0.1   (tenths)
 *   "1|.2"   → 1     (ones)
 *   "12|.3"  → 1     (ones — digit left of cursor is '2')
 *   "1|2.3"  → 10    (tens — digit left of cursor is '1')
 *   "1.23|"  → 0.01  (hundredths)
 */
export function getScrollIncrement(value: string, cursorPos: number): number {
  // Walk left from cursor to find the nearest digit
  let digitIdx = -1;
  for (let i = cursorPos - 1; i >= 0; i--) {
    const ch = value[i];
    if (ch >= '0' && ch <= '9') { digitIdx = i; break; }
    if (ch === '-') break; // stop at sign — no digit to the left of the minus
  }
  if (digitIdx === -1) return 1; // default to ones

  const dotPos = value.indexOf('.');
  const effectiveDotPos = dotPos === -1 ? value.length : dotPos;

  if (digitIdx < effectiveDotPos) {
    // Left of decimal: ones=0, tens=1, hundreds=2, …
    return Math.pow(10, effectiveDotPos - digitIdx - 1);
  } else {
    // Right of decimal: tenths=−1, hundredths=−2, …
    return Math.pow(10, dotPos - digitIdx);
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

const DEFAULT_CLASS =
  'w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-blue-500';

interface NumberInputProps {
  value: number;
  min?: number;
  max?: number;
  /** Kept for API compatibility; does not affect scroll behaviour. */
  step?: number;
  onChange: (v: number) => void;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onClick?: (e: React.MouseEvent<HTMLInputElement>) => void;
}

export default function NumberInput({
  value,
  min,
  max,
  onChange,
  className = DEFAULT_CLASS,
  onKeyDown,
  onClick,
}: NumberInputProps) {
  const inputRef   = useRef<HTMLInputElement>(null);
  const editingRef = useRef(false);
  const [text, setText] = useState(String(value));

  // Keep display in sync with external value changes (e.g. lock X/Y sync)
  // but leave it alone while the user is actively typing.
  useEffect(() => {
    if (!editingRef.current) {
      setText(String(value));
    }
  }, [value]);

  const clamp = (n: number): number => {
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  };

  const commit = (raw: string) => {
    editingRef.current = false;
    const n = parseFloat(raw);
    if (!isNaN(n)) {
      const clamped = clamp(n);
      setText(String(clamped));
      onChange(clamped);
    } else {
      // Restore to last valid value
      setText(String(value));
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    editingRef.current = true;
    const raw = e.target.value;
    setText(raw);
    const n = parseFloat(raw);
    if (!isNaN(n)) onChange(clamp(n));
  };

  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = inputRef.current!;
    const cursorPos   = el.selectionStart ?? text.length;
    const delta       = e.deltaY < 0 ? 1 : -1;
    const increment   = getScrollIncrement(text, cursorPos);
    const current     = parseFloat(text);
    if (isNaN(current)) return;

    const newVal      = clamp(current + delta * increment);
    const decPlaces   = increment < 1 ? Math.round(-Math.log10(increment)) : 0;
    const newStr      = newVal.toFixed(decPlaces);

    // Update without going through the editingRef guard so the prop syncs cleanly
    editingRef.current = false;
    setText(newStr);
    onChange(parseFloat(newStr));

    // Restore cursor position after React re-renders the input value
    requestAnimationFrame(() => {
      if (el) {
        const pos = Math.min(cursorPos, newStr.length);
        el.setSelectionRange(pos, pos);
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit((e.target as HTMLInputElement).value);
      (e.target as HTMLInputElement).blur();
    }
    onKeyDown?.(e);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={text}
      onChange={handleChange}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={handleKeyDown}
      onClick={onClick}
      onWheel={handleWheel}
      className={className}
    />
  );
}

import { useEffect, useRef, useState } from 'react';
import type { FocusEvent, MouseEvent } from 'react';
import { createPortal } from 'react-dom';

const DELAY_MS = 250;

/**
 * A hover label for a toolbar button: drawn over the page (a portal, under
 * the button), so a step column that clips its bar doesn't cut it off. Shown
 * on hover after a short pause, and on keyboard focus; hidden on click, and
 * while `disabled` (its menu is open).
 */
export function useHoverTip(label: string, disabled = false) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const place = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    // Keep a centred label of a few words on screen at either edge.
    const x = Math.min(Math.max(r.left + r.width / 2, 80), window.innerWidth - 80);
    setAt({ x, y: r.bottom + 6 });
  };
  const hide = () => { window.clearTimeout(timer.current); setAt(null); };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const tipProps = {
    onMouseEnter: (e: MouseEvent<HTMLElement>) => {
      const el = e.currentTarget;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => place(el), DELAY_MS);
    },
    onMouseLeave: hide,
    onMouseDown: hide,
    onFocus: (e: FocusEvent<HTMLElement>) => {
      let keyboard = false;
      try { keyboard = e.currentTarget.matches(':focus-visible'); } catch { /* older engines */ }
      if (keyboard) place(e.currentTarget);
    },
    onBlur: hide,
  };

  const tip = at && !disabled && createPortal(
    <div className="hover-tip" role="tooltip" style={{ left: at.x, top: at.y }}>{label}</div>,
    document.body,
  );

  return { tipProps, tip };
}

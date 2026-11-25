import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import SymbolIcon from './SymbolIcon';

/**
 * Zooming the whole workflow (owner, 2026-11-25): see every step at once, or
 * one formula up close, without losing your place. The steps' container is
 * scaled with CSS `zoom` (layout follows, so scrolling and the steps' map
 * keep working), and the point under the pointer, or the view's centre,
 * stays where it is. Pinch, or ⌃/⌘ + wheel, over the steps; or the control
 * in the canvas's bottom-right corner.
 *
 * The canvas's dots (MainLayout.css, `.horizontal-scroll-area`) scale with
 * the zoom and move at half the scroll's speed, so the space reads as one
 * surface with depth behind the steps.
 */

export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 1.5;
const clamp = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
/** The button steps: each press is one of these. */
const STOPS = [0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 1, 1.25, 1.5];

export function useCanvasZoom(
  canvasRef: React.RefObject<HTMLElement | null>,
  columnsRef: React.RefObject<HTMLElement | null>,
) {
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  /** Where to keep still across the next render: a content point, and where on screen it was. */
  const anchor = useRef<{ content: number; screen: number } | null>(null);
  const anim = useRef<number | null>(null);

  /** Set the zoom now, keeping *screenX* (in the canvas, px from its left) still. */
  const apply = useCallback((next: number, screenX?: number) => {
    const el = canvasRef.current;
    const z = clamp(next);
    if (el) {
      const x = screenX ?? el.clientWidth / 2;
      const off = columnsRef.current?.offsetLeft ?? 0;
      anchor.current = { content: (el.scrollLeft + x - off) / zoomRef.current, screen: x };
    }
    zoomRef.current = z;
    setZoom(z);
  }, [canvasRef, columnsRef]);

  // After the new zoom is laid out, scroll so the anchor is back under the pointer.
  useLayoutEffect(() => {
    const el = canvasRef.current;
    const a = anchor.current;
    if (!el || !a) return;
    const off = columnsRef.current?.offsetLeft ?? 0;
    el.scrollLeft = a.content * zoom + off - a.screen;
    anchor.current = null;
  }, [zoom, canvasRef, columnsRef]);

  /** Glide to *target* over ~180 ms (the buttons, fit). */
  const zoomTo = useCallback((target: number, screenX?: number) => {
    if (anim.current) cancelAnimationFrame(anim.current);
    const from = zoomRef.current;
    const to = clamp(target);
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 180);
      const eased = 1 - (1 - k) ** 3;
      apply(from + (to - from) * eased, screenX);
      anim.current = k < 1 ? requestAnimationFrame(step) : null;
    };
    anim.current = requestAnimationFrame(step);
  }, [apply]);

  const zoomIn = useCallback(() => zoomTo(STOPS.find((s) => s > zoomRef.current + 0.001) ?? ZOOM_MAX), [zoomTo]);
  const zoomOut = useCallback(() => zoomTo([...STOPS].reverse().find((s) => s < zoomRef.current - 0.001) ?? ZOOM_MIN), [zoomTo]);
  /** Every step in view: the steps' natural width against the canvas's. */
  const fit = useCallback(() => {
    const el = canvasRef.current;
    const cols = columnsRef.current;
    if (!el || !cols) return;
    // The scroller isn't zoomed: its scroll width is the steps' width on screen.
    const natural = (el.scrollWidth - cols.offsetLeft) / zoomRef.current;
    const room = el.clientWidth - cols.offsetLeft;
    if (natural > 0) zoomTo(Math.min(1, room / natural), 0);
  }, [canvasRef, columnsRef, zoomTo]);

  // Pinch (a ctrl+wheel to the browser) or ⌃/⌘ + wheel over the steps zooms
  // there; any other wheel scrolls as before. Not passive: it must keep the
  // page itself from zooming.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (anim.current) { cancelAnimationFrame(anim.current); anim.current = null; }
      const x = e.clientX - el.getBoundingClientRect().left;
      // A trackpad pinch sends many small deltas; a mouse wheel's notch is
      // one big one (~100), which would jump the zoom. A notch is one 15% step.
      const big = Math.abs(e.deltaY) >= 40;
      const factor = big ? (e.deltaY > 0 ? 1 / 1.15 : 1.15) : Math.exp(-e.deltaY * 0.01);
      apply(zoomRef.current * factor, x);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [canvasRef, apply]);

  // The dots: their spacing follows the zoom, their offset half the scroll.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const paint = () => {
      el.style.setProperty('--dots-size', `${22 * zoomRef.current}px`);
      el.style.setProperty('--dots-x', `${-el.scrollLeft * 0.5}px`);
    };
    paint();
    el.addEventListener('scroll', paint, { passive: true });
    return () => el.removeEventListener('scroll', paint);
  }, [canvasRef, zoom]);

  return { zoom, zoomIn, zoomOut, zoomTo, fit };
}

/** The zoom's control: bottom right of the canvas, just above the steps' map. */
export default function CanvasZoom({ zoom, onIn, onOut, onReset, onFit }: {
  zoom: number;
  onIn: () => void;
  onOut: () => void;
  onReset: () => void;
  onFit: () => void;
}) {
  return (
    <div className="canvas-zoom" role="group" aria-label="Zoom the steps" data-testid="canvas-zoom"
      onMouseDown={(e) => e.stopPropagation()}>
      <button type="button" onClick={onOut} disabled={zoom <= ZOOM_MIN + 0.001}
        aria-label="Zoom out" title="Zoom out · pinch or ⌘/⌃ + scroll over the steps">
        <SymbolIcon name="remove" size={16} />
      </button>
      <button type="button" className="canvas-zoom__level" onClick={onReset}
        aria-label="Back to 100%" title="Back to 100%">
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" onClick={onIn} disabled={zoom >= ZOOM_MAX - 0.001}
        aria-label="Zoom in" title="Zoom in · pinch or ⌘/⌃ + scroll over the steps">
        <SymbolIcon name="add" size={16} />
      </button>
      <button type="button" onClick={onFit} aria-label="Fit every step" title="Fit every step in view">
        <SymbolIcon name="fit_screen" size={16} />
      </button>
    </div>
  );
}

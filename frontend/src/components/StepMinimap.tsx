import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { RunState } from '../utils/runState';

/** One step on the map: what it's called, its colour, and where its run stands. */
export interface MinimapStep { id: string; label: string; color: string; run?: RunState }

interface Span { left: number; width: number }

/**
 * The steps' map, along the bottom of the steps (owner, 2026-10-30): each
 * step as a thin copy of its header — the same arrow, in its colour, as wide
 * as its column, its sides outlined in its run's colour, as the header's are
 * — and an outline (no fill) round what's in view. It replaces the horizontal
 * scrollbar: drag the outline to scroll, click a step to jump to it and open
 * it, click the track to centre the view there. Scrolling the steps any
 * other way moves the outline.
 *
 * *scroller* is the steps' scrolling element; each step's column is its
 * `.column-wrapper` child, in workflow order.
 */
export default function StepMinimap({ scroller, steps, onOpen }: {
  scroller: React.RefObject<HTMLElement | null>;
  steps: MinimapStep[];
  /** Open (expand) a step: a click on its arrow jumps to it and opens it. */
  onOpen?: (id: string) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ total: 1, scrollLeft: 0, visible: 1, trackWidth: 1 });
  const [spans, setSpans] = useState<Span[]>([]);
  // The hovered step's label, above its arrow: "Step 3 · scored". Over the
  // page (a portal), since the map itself is only a strip.
  const [hover, setHover] = useState<{ text: string; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = scroller.current;
    const bar = track.current;
    if (!el || !bar) return;
    const measure = () => {
      const cols = Array.from(el.querySelectorAll<HTMLElement>('.column-wrapper'));
      const next = cols.map((c) => ({ left: c.offsetLeft, width: c.offsetWidth }));
      setSpans((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      const v = { total: Math.max(1, el.scrollWidth), scrollLeft: el.scrollLeft, visible: el.clientWidth, trackWidth: Math.max(1, bar.clientWidth) };
      setView((prev) => (prev.total === v.total && prev.scrollLeft === v.scrollLeft && prev.visible === v.visible
        && prev.trackWidth === v.trackWidth ? prev : v));
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    ro?.observe(bar);
    el.querySelectorAll('.column-wrapper').forEach((c) => ro?.observe(c));
    return () => { el.removeEventListener('scroll', measure); ro?.disconnect(); };
    // Re-wired when the steps change, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scroller, steps.map((s) => s.id).join('\u0001')]);

  const k = view.trackWidth / view.total;            // track pixels per scroll pixel
  const jump = (left: number) => scroller.current?.scrollTo({ left, behavior: 'smooth' });

  // Drag the outline: the steps scroll with it.
  const drag = useRef<{ x: number; scrollLeft: number } | null>(null);
  const onOutlineDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    drag.current = { x: e.clientX, scrollLeft: scroller.current?.scrollLeft ?? 0 };
    const move = (m: PointerEvent) => {
      const d = drag.current;
      if (d && scroller.current) scroller.current.scrollLeft = d.scrollLeft + (m.clientX - d.x) / k;
    };
    const up = () => { drag.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  // The step under the pointer, anywhere on the map: its label, above its arrow.
  const onTrackMove = (e: React.MouseEvent) => {
    const bar = track.current;
    if (!bar) return;
    const box = bar.getBoundingClientRect();
    const x = (e.clientX - box.left) / k;
    const i = spans.findIndex((sp) => x >= sp.left && x < sp.left + sp.width);
    if (i < 0) { setHover(null); return; }
    const s = steps[i];
    const text = `Step ${i + 1} · ${s.label}${s.run ? ` · ${s.run.text}` : ''}`;
    const at = box.left + (spans[i].left + spans[i].width / 2) * k;
    setHover((prev) => (prev && prev.text === text && prev.x === at ? prev : { text, x: at, y: box.top }));
  };
  // A click on the track, off any step: centre the view there.
  const onTrackClick = (e: React.MouseEvent) => {
    const bar = track.current;
    if (!bar) return;
    const x = e.clientX - bar.getBoundingClientRect().left;
    jump(x / k - view.visible / 2);
  };

  return (
    <div
      className="step-minimap"
      ref={track}
      onClick={onTrackClick}
      // The label follows the pointer along the whole map, so a step under
      // the view's outline still says what it is and where its run stands.
      onMouseMove={onTrackMove}
      onMouseLeave={() => setHover(null)}
      role="navigation"
      aria-label="Steps map"
    >
      {steps.map((s, i) => {
        const span = spans[i];
        if (!span) return null;
        const left = span.left * k;
        const width = Math.max(4, span.width * k);
        return (
          <button
            key={s.id}
            type="button"
            className={`step-minimap-step run-paint${i === 0 ? ' first' : ''}${s.run ? ` run-${s.run.kind}` : ''}`}
            style={{ left, width, '--fill': s.color } as React.CSSProperties}
            aria-label={`Go to step ${i + 1}, ${s.label}${s.run ? `, ${s.run.text}` : ''}`}
            onClick={(e) => { e.stopPropagation(); setHover(null); onOpen?.(s.id); jump(span.left); }}
          />
        );
      })}
      <div
        className="step-minimap-view"
        style={{ left: view.scrollLeft * k, width: Math.max(8, view.visible * k) }}
        onPointerDown={onOutlineDown}
        onClick={(e) => e.stopPropagation()}
        role="scrollbar"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, view.total - view.visible)}
        aria-valuenow={Math.round(view.scrollLeft)}
        aria-label="Steps in view"
      />
      {hover && createPortal(
        <div className="step-minimap-label" role="tooltip" style={{ left: hover.x, top: hover.y }}>{hover.text}</div>,
        document.body,
      )}
    </div>
  );
}

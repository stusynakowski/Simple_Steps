import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** One step on the map: what it's called and its colour. */
export interface MinimapStep { id: string; label: string; color: string }

interface Span { left: number; width: number }

/**
 * The steps' map, along the bottom of the steps (owner, 2026-10-30): each
 * step as a thin copy of its header — the same arrow, in its colour, as wide
 * as its column — and an outline (no fill) round what's in view. It replaces
 * the horizontal scrollbar: drag the outline to scroll, click a step to jump
 * to it, click the track to centre the view there. Scrolling the steps any
 * other way moves the outline.
 *
 * *scroller* is the steps' scrolling element; each step's column is its
 * `.column-wrapper` child, in workflow order.
 */
export default function StepMinimap({ scroller, steps }: {
  scroller: React.RefObject<HTMLElement | null>;
  steps: MinimapStep[];
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
  // A click on the track, off any step: centre the view there.
  const onTrackClick = (e: React.MouseEvent) => {
    const bar = track.current;
    if (!bar) return;
    const x = e.clientX - bar.getBoundingClientRect().left;
    jump(x / k - view.visible / 2);
  };

  return (
    <div className="step-minimap" ref={track} onClick={onTrackClick} role="navigation" aria-label="Steps map">
      {steps.map((s, i) => {
        const span = spans[i];
        if (!span) return null;
        return (
          <button
            key={s.id}
            type="button"
            className={`step-minimap-step${i === 0 ? ' first' : ''}`}
            style={{ left: span.left * k, width: Math.max(4, span.width * k), background: s.color }}
            aria-label={`Go to step ${i + 1}, ${s.label}`}
            onClick={(e) => { e.stopPropagation(); setHover(null); jump(span.left); }}
            onMouseEnter={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setHover({ text: `Step ${i + 1} · ${s.label}`, x: r.left + r.width / 2, y: r.top });
            }}
            onMouseLeave={() => setHover(null)}
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

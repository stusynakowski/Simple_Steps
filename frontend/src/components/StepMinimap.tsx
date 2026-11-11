import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { RunState } from '../utils/runState';

/** One step on the map: what it's called, its colour, and where its run stands. */
export interface MinimapStep { id: string; label: string; color: string; run?: RunState }

interface Span { left: number; width: number }

/** The map's arrow depth in pixels: `--d` on `.step-minimap-step`. */
const ARROW_DEPTH = 6;

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
  // The resource column, left of the steps (owner, 2026-11-11): an "R" on the map.
  const [res, setRes] = useState<Span | null>(null);
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
      const rc = el.querySelector<HTMLElement>('.resource-column');
      const r = rc && rc.offsetWidth > 0 ? { left: rc.offsetLeft, width: rc.offsetWidth } : null;
      setRes((prev) => (prev?.left === r?.left && prev?.width === r?.width ? prev : r));
      const v = { total: Math.max(1, el.scrollWidth), scrollLeft: el.scrollLeft, visible: el.clientWidth, trackWidth: Math.max(1, bar.clientWidth) };
      setView((prev) => (prev.total === v.total && prev.scrollLeft === v.scrollLeft && prev.visible === v.visible
        && prev.trackWidth === v.trackWidth ? prev : v));
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    ro?.observe(bar);
    el.querySelectorAll('.column-wrapper, .resource-column').forEach((c) => ro?.observe(c));
    return () => { el.removeEventListener('scroll', measure); ro?.disconnect(); };
    // Re-wired when the steps change, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scroller, steps.map((s) => s.id).join('\u0001')]);

  // The steps fill the map end to end (owner, 2026-11-11): the scale runs
  // from the first step's left to the last step's right, not the whole
  // scroll width, so space past the steps leaves no blank on the map.
  const origin = res ? res.left : spans.length ? spans[0].left : 0;
  const end = spans.length ? spans[spans.length - 1].left + spans[spans.length - 1].width : view.total;
  const k = view.trackWidth / Math.max(1, end - origin);  // track pixels per scroll pixel
  const toTrack = (x: number) => (x - origin) * k;
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
    const x = (e.clientX - box.left) / k + origin;
    // Each step reaches to the next one's start: no gaps on the map.
    const i = spans.findIndex((sp, j) => x >= sp.left && x < (spans[j + 1]?.left ?? sp.left + sp.width));
    if (i < 0 && res && x >= res.left && x < res.left + res.width) {
      const at = box.left + toTrack(res.left + res.width / 2);
      setHover((prev) => (prev && prev.text === 'Resources' && prev.x === at ? prev : { text: 'Resources', x: at, y: box.top }));
      return;
    }
    if (i < 0) { setHover(null); return; }
    const s = steps[i];
    const text = `Step ${i + 1} · ${s.label}${s.run ? ` · ${s.run.text}` : ''}`;
    const at = box.left + toTrack(spans[i].left + spans[i].width / 2);
    setHover((prev) => (prev && prev.text === text && prev.x === at ? prev : { text, x: at, y: box.top }));
  };
  // A click on the track, off any step: centre the view there.
  const onTrackClick = (e: React.MouseEvent) => {
    const bar = track.current;
    if (!bar) return;
    const x = e.clientX - bar.getBoundingClientRect().left;
    jump(x / k + origin - view.visible / 2);
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
      {res && (
        <button
          type="button"
          className="step-minimap-res"
          style={{ left: toTrack(res.left), width: Math.max(14, res.width * k - 2) }}
          aria-label="Go to the resources"
          onClick={(e) => { e.stopPropagation(); setHover(null); jump(res.left); }}
        >R</button>
      )}
      {steps.map((s, i) => {
        const span = spans[i];
        if (!span) return null;
        const left = toTrack(span.left);
        // To the next step's start, plus the arrow's depth (--d) so its tip
        // fills the next one's tail, as the headers interlock.
        const next = spans[i + 1];
        const width = Math.max(4, next ? toTrack(next.left) - left + ARROW_DEPTH : span.width * k);
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
        style={{ left: toTrack(view.scrollLeft), width: Math.max(8, view.visible * k) }}
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

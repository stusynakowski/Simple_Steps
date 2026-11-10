/**
 * The Formula panel's map from the formula to its fields (owner, 2026-11-10):
 * the formula, exploded into its parts across the top, and a dotted line from
 * each part to the field below that edits it.
 *
 *   =with_tax [mod.map(), mod.name("total")] (wf["items"], rate=0.1)
 *    ┆         ┆          ┆                   ┆            ┆
 *   Tool      1. map      2. name             runs over    rate
 *
 * The parts come from the backend's parser (`operation_formula.spans`), the
 * same reader core uses, so the map never disagrees with what runs. A field
 * says which part it edits with `data-map-target="<key>"`; a part's key is
 * `tool`, `mod:<i>`, `input`, `res:<i>`, `arg:<name>`, or for a pick `step`
 * and `sel:<i>`, for a literal `value`. Hovering either end lights both.
 *
 * Lines run down the gutter at a field's left, then into the field, so they
 * never cross a field; the divider between the columns is the gutter for the
 * arguments, which keeps the lines matched while it is dragged.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { FormulaSpans, Span } from '../utils/formulaParser';

/** One part of the formula: where it is, and which field edits it. */
export interface MapPart { key: string; target: string; span: Span; kind: PartKind }
export type PartKind = 'tool' | 'modifier' | 'input' | 'resource' | 'argument' | 'value';

/** The formula's parts, in text order. A pick's parts edit the runs-over row and its select. */
export function mapParts(spans: FormulaSpans | undefined): MapPart[] {
  if (!spans) return [];
  const out: MapPart[] = [];
  if (spans.tool) out.push({ key: 'tool', target: 'tool', span: spans.tool, kind: 'tool' });
  spans.modifiers?.forEach((s, i) => out.push({ key: `mod:${i}`, target: `mod:${i}`, span: s, kind: 'modifier' }));
  if (spans.input) out.push({ key: 'input', target: 'input', span: spans.input, kind: 'input' });
  spans.resources?.forEach((s, i) => out.push({ key: `res:${i}`, target: `res:${i}`, span: s, kind: 'resource' }));
  for (const [name, s] of Object.entries(spans.arguments ?? {})) {
    out.push({ key: `arg:${name}`, target: `arg:${name}`, span: s, kind: 'argument' });
  }
  if (spans.step) out.push({ key: 'step', target: 'input', span: spans.step, kind: 'input' });
  spans.selectors?.forEach((s, i) => out.push({ key: `sel:${i}`, target: 'mod:0', span: s, kind: 'modifier' }));
  if (spans.value) out.push({ key: 'value', target: 'value', span: spans.value, kind: 'value' });
  return out.sort((a, b) => a.span[0] - b.span[0]);
}

/** The formula as text runs and chips, one chip per part. */
export function ExplodedFormula({ formula, parts, hot, onHot }: {
  formula: string;
  parts: MapPart[];
  hot: string | null;
  onHot: (target: string | null) => void;
}) {
  const pieces: React.ReactNode[] = [];
  let at = 0;
  for (const p of parts) {
    const [a, b] = p.span;
    if (a < at || b > formula.length) continue;          // a span that lags the text
    if (a > at) pieces.push(<span key={`t${at}`} className="fm-text">{formula.slice(at, a)}</span>);
    pieces.push(
      <span
        key={p.key}
        className={`fm-chip fm-${p.kind}${hot === p.target ? ' fm-hot' : ''}`}
        data-map-key={p.key}
        data-map-to={p.target}
        onMouseEnter={() => onHot(p.target)}
        onMouseLeave={() => onHot(null)}
      >{formula.slice(a, b)}</span>,
    );
    at = b;
  }
  if (at < formula.length) pieces.push(<span key={`t${at}`} className="fm-text">{formula.slice(at)}</span>);
  return <div className="fm-formula" aria-label="The formula, part by part">{pieces}</div>;
}

interface Line { key: string; d: string; kind: string; target: string }

/** Pixels between the lines' lanes under the formula, and between their tracks in a column's gutter. */
const LANE = 4;
const TRACK = 2;

/** The height of the band the lanes run in, for *n* lines: the columns start below it. */
export const laneBand = (n: number) => LANE * (n + 1) + 4;

/**
 * The dotted lines, drawn over *root*: from each chip down its column's
 * gutter into the field it maps to. Redrawn whenever *root* changes size
 * (the divider, the window, a field growing) or *deps* change.
 */
export function MapLines({ root, hot, deps }: {
  root: RefObject<HTMLElement | null>;
  hot: string | null;
  deps: unknown[];
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const frame = useRef(0);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const draw = () => {
      const box = el.getBoundingClientRect();
      const rel = (r: DOMRect) => ({ l: r.left - box.left, t: r.top - box.top, r: r.right - box.left, b: r.bottom - box.top });
      const next: Line[] = [];
      const chips = [...el.querySelectorAll<HTMLElement>('[data-map-key]')];
      const strip = el.querySelector('.fm-formula')?.getBoundingClientRect();
      const stripBottom = strip ? rel(strip).b : 0;
      // Each line has its own lane in the band under the formula (LANE apart)
      // and its own track in its column's gutter (TRACK apart), so no line
      // runs over text or along another line.
      const perColumn = new Map<Element, number>();
      chips.forEach((chip, i) => {
        const target = chip.dataset.mapTo!;
        const field = el.querySelector<HTMLElement>(`[data-map-target="${CSS.escape(target)}"]`);
        if (!field) return;
        const c = rel(chip.getBoundingClientRect());
        const f = rel(field.getBoundingClientRect());
        const column = field.closest<HTMLElement>('.te-col');
        const k = column ? perColumn.get(column) ?? 0 : 0;
        if (column) perColumn.set(column, k + 1);
        const gutter = column ? rel(column.getBoundingClientRect()).l + 3 + Math.min(k, 5) * TRACK : f.l - 6;
        const x1 = (c.l + c.r) / 2;
        const lane = stripBottom + LANE + i * LANE;
        const y2 = f.t + Math.min(12, (f.b - f.t) / 2);
        next.push({
          key: chip.dataset.mapKey!, target, kind: [...chip.classList].find((k) => k.startsWith('fm-') && k !== 'fm-chip' && k !== 'fm-hot') ?? '',
          d: `M ${x1} ${c.b} V ${lane} H ${gutter} V ${y2} H ${f.l}`,
        });
      });
      setSize({ w: box.width, h: box.height });
      setLines((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    const schedule = () => { cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(draw); };
    schedule();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    el.querySelectorAll('.te-col, .fm-formula').forEach((n) => ro.observe(n));
    return () => { ro.disconnect(); cancelAnimationFrame(frame.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redraw when the caller's content changes
  }, deps);

  return (
    <svg className="fm-lines" width={size.w} height={size.h} aria-hidden>
      {lines.map((l) => (
        <path key={l.key} d={l.d} className={`fm-line ${l.kind}${hot === l.target ? ' fm-hot' : ''}`} />
      ))}
    </svg>
  );
}

/**
 * The Formula panel's map from the formula to its fields (owner, 2026-11-10):
 * the formula centred as `f(x) = …`, each part labelled right under it, and a
 * dotted line from each label down into the field that edits it.
 *
 *            f(x) = with_tax [mod.map()] (wf["items"], rate=0.1)
 *                   tool      modifier    runs over    rate
 *     ┌─────────────┘   ┌────────┘          └──────┐     └────┐
 *     └► [with_tax ▾]   │   │ runs over [wf["items"]] ◄──┘    │
 *        ┌ 1. map ┐ ◄───┘   │   [n]  ◄── branch: a column core fills n from
 *                           │ rate      [0.1]      ◄──────────┘
 *       Tool + Modifiers    ┆  Arguments
 *
 * Each line comes into its field from a gutter: the tool's from the left of
 * its column, the modifiers' down the divider into the left column's right
 * side, the arguments' down the right. The tool's line takes the top lane,
 * then the arguments', then the modifiers'; within each, the part nearest
 * its gutter takes the higher lane and the outer track. So the lines nest
 * and none crosses another. Minimized, the modifiers' lines end at their
 * heading.
 *
 * The parts come from the backend's parser (`operation_formula.spans`), the
 * same reader core uses, so the map never disagrees with what runs. A field
 * says which part it edits with `data-map-target="<key>"`; a part's key is
 * `tool`, `mod:<i>`, `input`, `res:<i>`, `arg:<name>`, or for a pick `step`
 * and `sel:<i>`, for a literal `value`. Hovering either end lights both.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { FormulaSpans, Span } from '../utils/formulaParser';

/** One part of the formula: where it is, what it's called, and which field edits it. */
export interface MapPart { key: string; target: string; span: Span; kind: PartKind; label: string }
export type PartKind = 'tool' | 'modifier' | 'input' | 'resource' | 'argument' | 'value';

/**
 * The formula's parts, in text order. A pick's parts edit the runs-over row
 * and its select. *toolLabel* names the tool part when it isn't a plain tool
 * (`modifier as tool`).
 */
export function mapParts(spans: FormulaSpans | undefined, toolLabel = 'tool'): MapPart[] {
  if (!spans) return [];
  const out: MapPart[] = [];
  const add = (key: string, target: string, span: Span, kind: PartKind, label: string) =>
    out.push({ key, target, span, kind, label });
  if (spans.tool) add('tool', 'tool', spans.tool, 'tool', toolLabel);
  const mods = spans.modifiers ?? [];
  mods.forEach((s, i) => add(`mod:${i}`, `mod:${i}`, s, 'modifier', mods.length > 1 ? `modifier ${i + 1}` : 'modifier'));
  if (spans.input) add('input', 'input', spans.input, 'input', 'runs over');
  spans.resources?.forEach((s, i) => add(`res:${i}`, `res:${i}`, s, 'resource', 'resource'));
  for (const [name, s] of Object.entries(spans.arguments ?? {})) add(`arg:${name}`, `arg:${name}`, s, 'argument', name);
  if (spans.step) add('step', 'input', spans.step, 'input', 'data');
  spans.selectors?.forEach((s, i) => add(`sel:${i}`, 'mod:0', s, 'modifier', 'selection'));
  if (spans.value) add('value', 'value', spans.value, 'value', 'value');
  return out.sort((a, b) => a.span[0] - b.span[0]);
}

/** `f(x) = ` and the formula, centred, each part a chip with its label under it. */
export function ExplodedFormula({ formula, parts, hot, onHot }: {
  formula: string;
  parts: MapPart[];
  hot: string | null;
  onHot: (target: string | null) => void;
}) {
  const pieces: React.ReactNode[] = [];
  // The `=` is the `f(x) =` in front.
  let at = /^\s*=?\s*/.exec(formula)![0].length;
  for (const p of parts) {
    const [a, b] = p.span;
    if (a < at || b > formula.length) continue;          // a span that lags the text
    if (a > at) pieces.push(<span key={`t${at}`} className="fm-text">{formula.slice(at, a)}</span>);
    pieces.push(
      <span
        key={p.key}
        className={`fm-part fm-${p.kind}${hot === p.target ? ' fm-hot' : ''}`}
        data-map-key={p.key}
        data-map-to={p.target}
        onMouseEnter={() => onHot(p.target)}
        onMouseLeave={() => onHot(null)}
      >
        <span className="fm-chip">{formula.slice(a, b)}</span>
        <span className="fm-label">{p.label}</span>
      </span>,
    );
    at = b;
  }
  if (at < formula.length) pieces.push(<span key={`t${at}`} className="fm-text">{formula.slice(at)}</span>);
  return (
    <div className="fm-formula" aria-label="The formula, part by part">
      <span className="fm-fx">f(x)</span><span className="fm-eq"> = </span>{pieces}
    </div>
  );
}

interface Line { key: string; d: string; kind: string; target: string }

/** Pixels between the lines' lanes under the formula, and between their tracks in a gutter. */
const LANE = 4;
const TRACK = 3;

/** The height of the band the lanes run in, for *n* lines: the fields start below it. */
export const laneBand = (n: number) => LANE * (n + 1) + 6;

/**
 * The dotted lines, drawn over *root*: from each part's label down to a lane,
 * out to a gutter (left for the tool, right for the rest), down, and into the
 * field it maps to. Redrawn whenever *root* changes size or *deps* change.
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
      const strip = el.querySelector('.fm-formula');
      if (!strip) { setLines((p) => (p.length ? [] : p)); return; }
      const stripBottom = rel(strip.getBoundingClientRect()).b;
      const ends = [...el.querySelectorAll<HTMLElement>('[data-map-key]')].flatMap((part) => {
        const target = part.dataset.mapTo!;
        // A modifier's field is gone while the Modifiers are minimized: its heading stands in.
        const field = el.querySelector<HTMLElement>(`[data-map-target="${CSS.escape(target)}"]`)
          ?? (target.startsWith('mod:') ? el.querySelector<HTMLElement>('[data-map-target="modifiers"]') : null);
        const column = field?.closest('.te-col');
        if (!field || !column) return [];
        const kind = [...part.classList].find((k) => k.startsWith('fm-') && k !== 'fm-part' && k !== 'fm-hot') ?? '';
        const col = rel(column.getBoundingClientRect());
        // The tool comes in from its column's left; the rest from their column's right.
        const left = kind === 'fm-tool';
        return [{
          key: part.dataset.mapKey!, target, kind, left,
          gutter: left ? col.l : col.r,
          from: rel(part.getBoundingClientRect()), to: rel(field.getBoundingClientRect()),
        }];
      });
      // Groups by gutter: the tool's (left), then the right-hand gutters from
      // the outermost in (the arguments', then the modifiers' in the divider).
      // Within a group, the part nearest its gutter first. The first line
      // takes the top lane and the outer track, so the lines nest, uncrossed.
      const groups = new Map<string, typeof ends>();
      for (const e of ends) {
        const g = `${e.left ? 'L' : 'R'}${Math.round(e.gutter)}`;
        groups.set(g, [...(groups.get(g) ?? []), e]);
      }
      const order = [...groups.values()].sort((a, b) =>
        (a[0].left === b[0].left ? b[0].gutter - a[0].gutter : a[0].left ? -1 : 1));
      const next: Line[] = [];
      /** Where the runs-over line comes down its track: the branches leave from there. */
      let runsOver: { gutter: number; y: number; kind: string } | null = null;
      let lane = 0;
      for (const group of order) {
        const mid = (e: typeof ends[number]) => (e.from.l + e.from.r) / 2;
        group.sort((a, b) => Math.abs(mid(a) - a.gutter) - Math.abs(mid(b) - b.gutter));
        group.forEach((e, k) => {
          const outer = Math.min(group.length - 1 - k, 4);
          const gutter = e.left ? e.gutter - 5 - outer * TRACK : e.gutter + 5 + outer * TRACK;
          const y = stripBottom + LANE * (++lane);
          const y2 = e.to.t + Math.min(11, (e.to.b - e.to.t) / 2);
          const into = e.left ? e.to.l : e.to.r;
          if (e.target === 'input') runsOver = { gutter, y: y2, kind: e.kind };
          next.push({ key: e.key, target: e.target, kind: e.kind, d: `M ${mid(e)} ${e.from.b} V ${y} H ${gutter} V ${y2} H ${into}` });
        });
      }
      // The runs-over line branches into each parameter core fills from its
      // columns, ending at the column's name over that field (owner, 2026-11-10).
      const from = runsOver as { gutter: number; y: number; kind: string } | null;
      if (from) {
        el.querySelectorAll<HTMLElement>('[data-map-fill]').forEach((fill, i) => {
          const f = rel(fill.getBoundingClientRect());
          const y = (f.t + f.b) / 2;
          next.push({ key: `fill:${i}`, target: 'input', kind: from.kind, d: `M ${from.gutter} ${from.y} V ${y} H ${f.r}` });
        });
      }
      setSize({ w: box.width, h: box.height });
      setLines((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    const schedule = () => { cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(draw); };
    schedule();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    el.querySelectorAll('.te-stack, .te-col, .te-section, .fm-formula').forEach((n) => ro.observe(n));
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

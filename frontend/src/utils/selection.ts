/**
 * Picking data from an earlier step while writing a formula (dev_plan/126 D1).
 *
 * A pick is the grid's own selection (utils/gridSelection.ts: a cell, a
 * block, rows, columns, the whole table, with Shift, ⌘/Ctrl and drag), written
 * in core's notation where the caret is:
 *
 *   whole table      wf["readings"]
 *   columns          wf["readings"][cols["n"]]   wf["readings"][cols[["city", "n"]]]
 *   one row          wf["readings"][3]
 *   scattered rows   wf["readings"][[0, 3]]
 *   a run of rows    wf["readings"][1:4]
 *   a cell           wf["readings"][3][cols["n"]]
 *   a block          wf["readings"][1:4][cols[["city", "n"]]]
 *
 * Rows are positions, 0..n-1, as core reads them: a step's `#` is its
 * position (core-asks M1), so the grid's row is what the formula says.
 *
 * Only the text is written here; the backend's parser reads it, and core
 * checks it. A selection that isn't one rectangle (scattered cells) has no
 * single reference, so it writes nothing.
 */
import { INDEX_COL } from './gridSelection';
import type { GridSel } from './gridSelection';
import type { FormulaReference } from './formulaParser';

/** What a pick in an earlier step's grid sends the formula being written. */
export interface GridPick {
  /** The selection in core's notation, or null when it can't be one reference. */
  text: string | null;
}

/** `wf["name"]`: the only way a formula refers to a step. */
export function stepRef(name: string): string {
  return `wf[${JSON.stringify(name)}]`;
}

const lit = (v: string | number) => (typeof v === 'number' ? String(v) : JSON.stringify(v));

/**
 * *sel* on step *step* in core's notation. *rows* and *cols* are the grid's
 * row positions and data columns, in order; *total* is the step's row count,
 * which may be more than the rows loaded: every loaded row is the whole
 * step only when every row is loaded.
 */
export function selectionText(
  step: string, sel: GridSel | null, rows: number[], cols: string[], total: number = rows.length,
): string | null {
  if (!sel || sel.kind === 'index') return null;
  const ref = stepRef(step);
  if (sel.kind === 'all') return ref;

  const picked = sel.cells.map((k) => {
    const at = k.indexOf(':');
    return { row: Number(k.slice(0, at)), col: k.slice(at + 1) };
  }).filter((c) => c.col !== INDEX_COL);
  const rowSet = new Set(picked.map((c) => c.row));
  const colSet = new Set(picked.map((c) => c.col));
  if (!picked.length || picked.length !== rowSet.size * colSet.size) return null;   // not one rectangle

  const rowList = rows.filter((r) => rowSet.has(r));
  const colList = cols.filter((c) => colSet.has(c));

  let rowPart = '';
  if (rowList.length !== total) {
    const first = rows.indexOf(rowList[0]);
    const contiguous = rowList.every((r, i) => rows[first + i] === r);
    if (contiguous && rowList.length > 1) rowPart = `[${rowList[0]}:${rowList[rowList.length - 1] + 1}]`;
    else rowPart = rowList.length === 1 ? `[${rowList[0]}]` : `[[${rowList.join(', ')}]]`;
  }
  let colPart = '';
  if (colList.length !== cols.length) {
    colPart = colList.length === 1
      ? `[cols[${lit(colList[0])}]]`
      : `[cols[[${colList.map(lit).join(', ')}]]]`;
  }
  return ref + rowPart + colPart;
}

/** Where a pick went in the formula, so the next pick can replace it. */
export interface PlacedPick { start: number; text: string }

/**
 * The formula with *text* (a pick) written into it, and where it went:
 *
 * - the last pick's text, still where it was written, is replaced (as in Excel);
 * - an empty formula becomes the pick; a whole step on its own is a reference,
 *   not a step, so it is written as a copy of its rows, `wf["r"][:]`;
 * - a formula waiting for its input, `tool[mod.map()](`, takes it in the call;
 * - otherwise it goes at the caret, replacing any selected text.
 */
export function placePick(
  value: string, caret: { start: number; end: number }, last: PlacedPick | null,
  text: string, wholeStep: boolean,
): { value: string; cursor: number; placed: PlacedPick } {
  if (last && value.slice(last.start, last.start + last.text.length) === last.text) {
    // When the formula is only the pick, it is still the step: a whole step copies.
    const step = wholeStep && value.trim() === `=${last.text}` ? `${text}[:]` : text;
    const next = value.slice(0, last.start) + step + value.slice(last.start + last.text.length);
    return { value: next, cursor: last.start + step.length, placed: { start: last.start, text: step } };
  }
  if (!value.trim().replace(/^=/, '').trim()) {
    const step = wholeStep ? `${text}[:]` : text;
    return { value: `=${step}`, cursor: step.length + 1, placed: { start: 1, text: step } };
  }
  const open = /^(.*)\(\s*(\))?\s*$/s.exec(value);
  if (open && /\]\s*$/.test(open[1])) {
    const next = `${open[1]}(${text})`;
    return { value: next, cursor: next.length, placed: { start: open[1].length + 1, text } };
  }
  const clamp = (n: number) => Math.max(0, Math.min(value.length, n));
  const start = clamp(caret.start);
  const end = clamp(Math.max(caret.end, start));
  return { value: value.slice(0, start) + text + value.slice(end), cursor: start + text.length, placed: { start, text } };
}

/** A rectangle of a grid: a run of adjacent rows (positions) by a run of adjacent columns. */
export interface GridBox { rows: number[]; cols: string[] }

/**
 * The cells of this grid a formula's reference covers (dev_plan/126 R3), as
 * rectangles to box: one per run of adjacent rows and adjacent columns.
 * Read as core reads it: rows are positions (a negative one counts back from
 * the step's *total* rows), columns are data columns by name or position, and
 * no rows or no columns means all of them. A condition (`cols["n"] > 5`)
 * boxes nothing: which rows match is core's to say, and a box around every
 * row would be wrong.
 */
export function referenceBoxes(
  ref: Pick<FormulaReference, 'rows' | 'columns'>, rows: number[], cols: string[],
  total: number = rows.length,
): GridBox[] {
  const at = (i: number) => (i < 0 ? total + i : i);
  let rowList = rows;
  const want = ref.rows;
  if (want !== undefined && want !== null) {
    if (typeof want === 'object' && !Array.isArray(want)) {
      if ('where' in want) return [];
      const start = want.start == null ? 0 : at(want.start);
      const stop = want.stop == null ? total : at(want.stop);
      rowList = rows.filter((r) => r >= start && r < stop);
    } else {
      const picked = new Set((Array.isArray(want) ? want : [want]).filter((v): v is number => typeof v === 'number').map(at));
      rowList = rows.filter((r) => picked.has(r));
    }
  }
  let colList = cols;
  const named = ref.columns;
  if (named && 'names' in named) colList = cols.filter((c) => named.names.includes(c));
  else if (named && 'from' in named) {
    const a = cols.indexOf(named.from);
    const b = cols.indexOf(named.to);
    colList = a < 0 || b < 0 ? [] : cols.slice(Math.min(a, b), Math.max(a, b) + 1);
  } else if (named && 'positions' in named) {
    const p = named.positions;
    const n = cols.length;
    const pos = (i: number) => (i < 0 ? n + i : i);
    colList = Array.isArray(p)
      ? p.map(pos).filter((i) => i >= 0 && i < n).map((i) => cols[i])
      : cols.slice(p.start == null ? 0 : pos(p.start), p.stop == null ? n : pos(p.stop));
  }
  const rowRuns = runs(rows, rowList);
  const colRuns = runs(cols, colList);
  return rowRuns.flatMap((r) => colRuns.map((c) => ({ rows: r, cols: c })));
}

/** *picked* split into runs that are adjacent in *order*. */
function runs<T>(order: T[], picked: T[]): T[][] {
  const out: T[][] = [];
  const set = new Set(picked);
  let run: T[] = [];
  for (const x of order) {
    if (set.has(x)) run.push(x);
    else if (run.length) { out.push(run); run = []; }
  }
  if (run.length) out.push(run);
  return out;
}

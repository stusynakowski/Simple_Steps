/**
 * Picking data from an earlier step while writing a formula (dev_plan/126 D1).
 *
 * A pick is the grid's own selection (utils/gridSelection.ts: a cell, a
 * block, rows, columns, the whole table, with Shift, ⌘/Ctrl and drag), written
 * in core's notation where the caret is:
 *
 *   whole table      wf["readings"]
 *   columns          wf["readings"][cols["n"]]   wf["readings"][cols[["city", "n"]]]
 *   one row          wf["readings"][3]            (core's row id, #)
 *   scattered rows   wf["readings"][[0, 3]]       (row ids)
 *   text row ids     wf["split"][rows["0.1"]]     (after expand or collapse; a
 *                    plain ["…"] would read as a column, so core asks for rows[…])
 *   a run of rows    wf["readings"][1:4]          (positions on screen, as core's ranges are)
 *   a cell           wf["readings"][3][cols["n"]]
 *   a block          wf["readings"][1:4][cols[["city", "n"]]]
 *
 * Only the text is written here; the backend's parser reads it, and core
 * checks it. A selection that isn't one rectangle (scattered cells) has no
 * single reference, so it writes nothing.
 */
import { INDEX_COL } from './gridSelection';
import type { GridSel } from './gridSelection';

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
 * row positions and data columns, in order; *idOf* gives each position's row
 * id (core's #), falling back to the position.
 */
export function selectionText(
  step: string, sel: GridSel | null, rows: number[], cols: string[],
  idOf: Record<number, string | number> = {},
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
  const id = (r: number) => idOf[r] ?? r;

  let rowPart = '';
  if (rowList.length !== rows.length) {
    const first = rows.indexOf(rowList[0]);
    const contiguous = rowList.every((r, i) => rows[first + i] === r);
    const ids = rowList.map(id);
    const texty = ids.some((v) => typeof v === 'string');
    if (contiguous && rowList.length > 1) rowPart = `[${rowList[0]}:${rowList[rowList.length - 1] + 1}]`;
    else {
      const one = ids.length === 1 ? lit(ids[0]) : `[${ids.map(lit).join(', ')}]`;
      rowPart = texty ? `[rows[${one}]]` : `[${one}]`;
    }
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

/**
 * Selecting data from an earlier step.
 *
 * A selection is a **select operation** on that step — a formula in core's
 * syntax, so the formula bar shows exactly what will run:
 *
 *   whole table   =identity[mod.slice()](wf["readings"])
 *   columns       =identity[mod.select(columns=["city", "n"])](wf["readings"])
 *   rows          =identity[mod.slice(at=[1, 3])](wf["readings"])
 *
 * Picking in an earlier step's grid edits that formula; the formula drives the
 * highlight in the grid. One source of truth: the formula text.
 *
 * Not yet: a subset of rows AND columns (a cell, a block) — core allows one
 * shape verb per step, so it waits on core 005 K9. See docs/dev_plan/121 §1.2.
 */

/** What a click in a grid asks for. Rows are positions, 0-based (core's `slice(at=…)`). */
export type GridPick =
  | { kind: 'all' }
  | { kind: 'column'; column: string; extend: boolean; toggle: boolean; order: string[] }
  | { kind: 'row'; row: number; extend: boolean; toggle: boolean; order: number[] };

export interface Selection {
  /** The step's name, as written in wf["…"]. */
  step: string;
  kind: 'all' | 'columns' | 'rows';
  columns: string[];
  rows: number[];
}

/** `wf["name"]` — the only way a formula refers to a step. */
export function stepRef(name: string): string {
  return `wf[${JSON.stringify(name)}]`;
}

/** The select-operation formula for *sel*. */
export function selectionFormula(sel: Selection): string {
  const ref = stepRef(sel.step);
  if (sel.kind === 'columns') {
    return `=identity[mod.select(columns=${JSON.stringify(sel.columns)})](${ref})`;
  }
  if (sel.kind === 'rows') {
    return `=identity[mod.slice(at=[${sel.rows.join(', ')}])](${ref})`;
  }
  return `=identity[mod.slice()](${ref})`;
}

const SELECT_FORMULA =
  /^\s*=?\s*identity\s*\[\s*mod\.(select|slice)\((.*)\)\s*\]\s*\(\s*wf\[\s*("(?:[^"\\]|\\.)*")\s*\]\s*\)\s*$/s;

/**
 * The selection a formula expresses, if it is a select operation this module
 * writes (whole table, columns, or rows by position). Anything else → null.
 */
export function parseSelectionFormula(formula: string | undefined | null): Selection | null {
  const match = SELECT_FORMULA.exec(formula ?? '');
  if (!match) return null;
  const [, verb, settings, quotedStep] = match;
  let step: string;
  try {
    step = JSON.parse(quotedStep);
  } catch {
    return null;
  }
  const body = settings.trim();
  if (verb === 'select') {
    const cols = /^columns\s*=\s*(\[.*\])$/s.exec(body);
    const parsed = cols ? parseList(cols[1]) : null;
    if (!parsed || !parsed.every((c) => typeof c === 'string')) return null;
    return { step, kind: 'columns', columns: parsed as string[], rows: [] };
  }
  if (body === '') return { step, kind: 'all', columns: [], rows: [] };
  const at = /^at\s*=\s*(\[.*\])$/s.exec(body);
  const parsed = at ? parseList(at[1]) : null;
  if (!parsed || !parsed.every((r) => Number.isInteger(r))) return null;
  return { step, kind: 'rows', columns: [], rows: parsed as number[] };
}

/**
 * Apply a click to the current selection. A plain click replaces it; with
 * ⌘/Ctrl it toggles one more column or row; with Shift it extends from the
 * last one picked. Picking from a different step, or switching between
 * columns and rows, starts over.
 */
export function applyPick(prev: Selection | null, step: string, pick: GridPick): Selection {
  if (pick.kind === 'all') return { step, kind: 'all', columns: [], rows: [] };

  if (pick.kind === 'column') {
    const same = prev && prev.step === step && prev.kind === 'columns' ? prev.columns : null;
    let columns = [pick.column];
    if (same && pick.toggle) {
      columns = same.includes(pick.column) ? same.filter((c) => c !== pick.column) : [...same, pick.column];
    } else if (same && pick.extend && same.length) {
      columns = between(pick.order, same[same.length - 1], pick.column, same);
    }
    if (columns.length === 0) return { step, kind: 'all', columns: [], rows: [] };
    // Keep the grid's left-to-right order.
    columns = pick.order.filter((c) => columns.includes(c));
    return { step, kind: 'columns', columns, rows: [] };
  }

  const same = prev && prev.step === step && prev.kind === 'rows' ? prev.rows : null;
  let rows = [pick.row];
  if (same && pick.toggle) {
    rows = same.includes(pick.row) ? same.filter((r) => r !== pick.row) : [...same, pick.row];
  } else if (same && pick.extend && same.length) {
    rows = between(pick.order, same[same.length - 1], pick.row, same);
  }
  if (rows.length === 0) return { step, kind: 'all', columns: [], rows: [] };
  rows = [...new Set(rows)].sort((a, b) => a - b);
  return { step, kind: 'rows', columns: [], rows };
}

/** A name for a select step made from *sel*, unique among *taken*. */
export function selectStepName(sel: Selection, taken: Set<string>): string {
  const what =
    sel.kind === 'columns' ? sel.columns.join('_')
    : sel.kind === 'rows' ? `rows_${sel.rows.join('_')}`
    : 'all';
  const base = `${sel.step}_${what}`.replace(/\s+/g, '_').slice(0, 40);
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
  return name;
}

/** Everything from *from* to *to* in *order*, added to *existing*. */
function between<T>(order: T[], from: T, to: T, existing: T[]): T[] {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0) return [...existing, to];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return [...new Set([...existing, ...order.slice(lo, hi + 1)])];
}

/** A Python-literal list of strings or numbers (double or single quotes). */
function parseList(text: string): unknown[] | null {
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : null;
  } catch {
    try {
      const value = JSON.parse(text.replace(/'/g, '"'));
      return Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  }
}

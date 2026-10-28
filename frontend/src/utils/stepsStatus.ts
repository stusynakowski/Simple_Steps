/**
 * The steps bar's status text: what the pointer is over in a step's grid, or
 * — while a formula bar is picking a reference — what it has selected.
 */

/** A spot in a step's data grid, as the grid reports it on hover. */
export type GridHover =
  | { step: string; kind: 'table' }
  | { step: string; kind: 'column'; column: string }
  | { step: string; kind: 'row'; row: number }
  | { step: string; kind: 'cell'; row: number; column: string; value?: string };

/** A grid's hover before its step is known (the grid doesn't know its step's name). */
export type GridSpot =
  | { kind: 'table' }
  | { kind: 'column'; column: string }
  | { kind: 'row'; row: number }
  | { kind: 'cell'; row: number; column: string; value?: string };

const MAX_VALUE = 40;

function clip(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > MAX_VALUE ? `${one.slice(0, MAX_VALUE - 1)}…` : one;
}

/** `readings · row 3, score = 4.2` */
export function describeHover(h: GridHover): string {
  switch (h.kind) {
    case 'table': return `${h.step} · whole table`;
    case 'column': return `${h.step} · column ${h.column}`;
    case 'row': return `${h.step} · row ${h.row}`;
    case 'cell': {
      const at = `${h.step} · row ${h.row}, ${h.column}`;
      return h.value !== undefined && h.value !== '' ? `${at} = ${clip(h.value)}` : at;
    }
  }
}

/** Runs of consecutive numbers as ranges: [1, 2, 3, 7] → "1–3, 7". */
export function compactRows(rows: number[]): string {
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : `${sorted[i]}`);
    i = j;
  }
  return parts.join(', ');
}

/**
 * What the bar shows: the hover if there is one, else the pick being made
 * for a formula, as it is written (`Selecting wf["readings"][cols["n"]]`),
 * else nothing.
 */
export function stepsStatusText(hover: GridHover | null, selection: string | null): string {
  if (hover) return describeHover(hover);
  if (selection) return `Selecting ${selection}`;
  return '';
}

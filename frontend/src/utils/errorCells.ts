import type { Cell } from '../types/models';

/**
 * Errors shown in the output grid, in the cell they belong to.
 *
 * - A step that fails as a whole (an expression that doesn't parse, an
 *   unknown tool, a run error) shows ONE cell holding the message.
 * - A step where only some rows failed (core records each failed unit in its
 *   ledger) shows each row's error in that row's result cell.
 *
 * Both are marked `metadata.error`, which the grid shades light red.
 */

export function isErrorCell(cell: Cell | undefined | null): boolean {
  return !!cell && cell.metadata?.error === true;
}

/** The single cell a failed step shows instead of its output. */
export function errorCell(message: string): Cell {
  return {
    row_id: 0,
    column_id: 'error',
    value: message,
    display_value: message,
    metadata: { error: true },
  };
}

/**
 * Put each failed row's error into its result cell.
 *
 * `rowErrors` maps an output row position to its error (`metrics.row_errors`
 * from /api/run); `column` is the column the step wrote (`payload_column`).
 * Rows outside `cells` (past the preview page) are left alone.
 */
export function withRowErrors(
  cells: Cell[],
  rowErrors: Record<string, string> | undefined,
  column: string | null | undefined,
): Cell[] {
  if (!rowErrors || !column) return cells;
  const shown = new Set(cells.map((c) => c.row_id));
  const out = cells.map((c) => {
    const error = c.column_id === column ? rowErrors[String(c.row_id)] : undefined;
    return error === undefined
      ? c
      : { ...c, value: error, display_value: error, metadata: { ...c.metadata, error: true } };
  });
  // A failed row's result cell may be absent (a null payload) — add it.
  for (const [row, error] of Object.entries(rowErrors)) {
    const rowId = Number(row);
    if (!shown.has(rowId)) continue;
    if (!out.some((c) => c.row_id === rowId && c.column_id === column)) {
      out.push({ row_id: rowId, column_id: column, value: error, display_value: error, metadata: { error: true } });
    }
  }
  return out;
}

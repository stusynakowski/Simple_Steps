import type { Cell } from '../types/models';

/**
 * Errors shown in the output grid, in the cell they belong to.
 *
 * A step that fails as a whole (an expression that doesn't parse, an unknown
 * tool, a run error) shows ONE cell holding the message, marked
 * `metadata.error`, which the grid shades light red. A row that failed is
 * core's own `failed` cell state (/api/view, dev_plan/126 R5).
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

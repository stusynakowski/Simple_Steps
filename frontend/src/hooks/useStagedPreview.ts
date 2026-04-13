import { useMemo } from 'react';
import type { Step } from '../types/models';
import type { OperationDefinition } from '../services/api';
import type { ParsedFormula } from '../utils/formulaParser';

export type StagedCellState = 'pending' | 'valid' | 'error' | 'passthrough' | 'empty';

export interface StagedCell {
  column: string;
  rowIndex: number;
  /** Human-readable description of what this cell will produce */
  displayValue: string;
  /** The expression/formula that drives this cell */
  formula: string;
  errorMessage?: string;
  state: StagedCellState;
}

export interface StagedColumn {
  name: string;
  isNew: boolean;
  isPassthrough: boolean;
  cells: StagedCell[];
}

export interface StagedPreview {
  columns: StagedColumn[];
  globalErrors: string[];
  isReady: boolean;
  description: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferOutputColumns(
  parsed: ParsedFormula,
  _op: OperationDefinition | undefined,
  upstreamColumns: string[]
): { name: string; isNew: boolean }[] {
  if (!parsed.isValid || !parsed.operationId) return [];

  if (parsed.operationId === 'passthrough') {
    return upstreamColumns.map((c) => ({ name: c, isNew: false }));
  }

  // Use output_col param hint if provided
  const colName = parsed.args?.output_col
    ? String(parsed.args.output_col)
    : `${parsed.operationId}_result`;

  return [{ name: colName, isNew: true }];
}

function buildCellFormula(
  opId: string,
  args: Record<string, string>,
  columnName: string,
  rowIndex: number,
  upstreamRow: Record<string, unknown> | undefined
): string {
  if (opId === 'passthrough') {
    const ref = String(args._ref || '');
    return ref ? `↳ ${ref}` : '(pass-through)';
  }

  const parts = Object.entries(args)
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => {
      const strV = String(v);
      // If value looks like a step reference (contains '.'), try to resolve it
      if (strV.includes('.') && upstreamRow) {
        const refParts = strV.split('.');
        const resolvedCol = refParts[refParts.length - 1];
        const resolved = upstreamRow[resolvedCol];
        return resolved !== undefined
          ? `${k}=${JSON.stringify(resolved)}`
          : `${k}=${strV}`;
      }
      return `${k}=${JSON.stringify(v)}`;
    })
    .join(', ');

  return `${opId}(row=${rowIndex}, col="${columnName}"${parts ? ', ' + parts : ''})`;
}

function validateArgs(
  op: OperationDefinition | undefined,
  args: Record<string, string>
): string[] {
  if (!op) return [];
  const errors: string[] = [];
  for (const param of op.params || []) {
    // Check required fields — OperationParam doesn't have `required` in the current
    // interface so we just check for empty values on params with no default
    const val = args[param.name];
    if (
      val === undefined || val === '' &&
      (param.default === undefined || param.default === '')
    ) {
      // Skip — not all params need to be filled to show a preview
    }
    if (
      param.type === 'number' &&
      val !== undefined &&
      val !== '' &&
      isNaN(Number(val))
    ) {
      errors.push(`Parameter "${param.name}" must be a number, got: "${val}"`);
    }
  }
  return errors;
}

// ─── Main Hook ────────────────────────────────────────────────────────────────

export interface UseStagedPreviewOptions {
  step: Step;
  parsed: ParsedFormula | null;
  availableOperations: OperationDefinition[];
  upstreamRows?: Record<string, unknown>[];
  upstreamColumns?: string[];
  previewRowCount?: number;
}

export function useStagedPreview({
  step,
  parsed,
  availableOperations,
  upstreamRows = [],
  upstreamColumns = [],
  previewRowCount = 6,
}: UseStagedPreviewOptions): StagedPreview {
  return useMemo<StagedPreview>(() => {
    const empty: StagedPreview = {
      columns: [],
      globalErrors: [],
      isReady: false,
      description: '',
    };

    if (!parsed) return empty;

    const { operationId, args = {}, isValid } = parsed;

    if (!operationId || operationId === 'noop') {
      return { ...empty, description: 'Select an operation to preview output.' };
    }

    const op = availableOperations.find((o) => o.id === operationId);

    const argErrors = isValid ? validateArgs(op, args) : [];

    const outputColDefs = inferOutputColumns(parsed, op, upstreamColumns);

    const globalErrors: string[] = [];
    if (operationId !== 'passthrough' && !op) {
      globalErrors.push(`Unknown operation: "${operationId}"`);
    }
    globalErrors.push(...argErrors);

    const rowCount =
      upstreamRows.length > 0
        ? Math.min(upstreamRows.length, previewRowCount)
        : previewRowCount;

    const columns: StagedColumn[] = [];

    // ── Passthrough columns (upstream, unchanged) ──────────────────────────
    if (operationId === 'passthrough') {
      for (const colName of upstreamColumns.slice(0, 8)) {
        const cells: StagedCell[] = Array.from({ length: rowCount }, (_, i) => {
          const upRow = upstreamRows[i];
          const val = upRow ? upRow[colName] : undefined;
          return {
            column: colName,
            rowIndex: i,
            displayValue: val !== undefined ? String(val) : 'staged',
            formula: `↳ ${colName}`,
            state: 'passthrough' as StagedCellState,
          };
        });
        columns.push({ name: colName, isNew: false, isPassthrough: true, cells });
      }
    }

    // ── New / output columns ───────────────────────────────────────────────
    for (const { name: colName, isNew } of outputColDefs) {
      const cells: StagedCell[] = Array.from({ length: rowCount }, (_, i) => {
        const upRow = upstreamRows[i];
        const cellFormula = buildCellFormula(operationId, args, colName, i, upRow);

        if (globalErrors.length > 0) {
          return {
            column: colName,
            rowIndex: i,
            displayValue: globalErrors[0],
            formula: cellFormula,
            errorMessage: globalErrors.join('; '),
            state: 'error' as StagedCellState,
          };
        }

        if (!isValid) {
          return {
            column: colName,
            rowIndex: i,
            displayValue: 'staged',
            formula: cellFormula,
            state: 'pending' as StagedCellState,
          };
        }

        return {
          column: colName,
          rowIndex: i,
          displayValue: 'staged',
          formula: cellFormula,
          state: 'valid' as StagedCellState,
        };
      });

      columns.push({ name: colName, isNew, isPassthrough: false, cells });
    }

    // ── Description ────────────────────────────────────────────────────────
    let description = '';
    if (operationId === 'passthrough') {
      description = `Pass-through: forwards ${upstreamColumns.length} upstream column(s) unchanged.`;
    } else if (op) {
      const mode = String(step.configuration._orchestrator || op.type || 'dataframe');
      description = `${op.label} — runs in "${mode}" mode, producing ${outputColDefs.length} column(s) across ${rowCount} row(s).`;
    } else if (operationId) {
      description = `Operation "${operationId}" — ${globalErrors.length ? 'has errors' : 'ready to run'}.`;
    }

    return {
      columns,
      globalErrors,
      isReady: isValid && globalErrors.length === 0,
      description,
    };
  }, [parsed, availableOperations, upstreamRows, upstreamColumns, previewRowCount, step.configuration]);
}

import { useMemo, useState } from 'react';
import { isErrorCell } from '../utils/errorCells';
import type { GridPick, Selection } from '../utils/selection';
import type { Cell } from '../types/models';
import type { StagedColumn } from '../hooks/useStagedPreview';
import CellViewer from './CellViewer';
import './OperationColumn.css'; // Ensure grid styles are available
import './CellViewer.css';

const TYPE_ICONS: Record<string, string> = { plotly: '📈', table: '▦', json: '{}' };

/**
 * What a cell shows. Text and numbers as they are; a typed value (an image, a
 * figure, a table, a dict — backend cell_types.py) as its preview or an icon,
 * plus its summary. The full value opens in the cell viewer on click.
 */
function CellContent({ cell }: { cell: Cell }) {
  if (!cell.cell_type) return <>{cell.display_value}</>;
  const summary = cell.summary ?? cell.display_value;
  return (
    <span className="typed-cell" data-cell-type={cell.cell_type}>
      {cell.preview
        ? <img className="typed-cell-thumb" src={cell.preview} alt="" />
        : TYPE_ICONS[cell.cell_type] && <span className="typed-cell-icon">{TYPE_ICONS[cell.cell_type]}</span>}
      <span className="typed-cell-text">{summary}</span>
    </span>
  );
}

interface DataOutputGridProps {
  cells?: Cell[];
  onCellClick?: (cell: Cell) => void;
  wiringMode?: boolean;
  /** In wiring mode: a click on the whole table, a column header or a row number. */
  onPick?: (pick: GridPick) => void;
  /** What the step being edited currently selects from this grid. */
  highlight?: Selection | null;
  /** Staged columns to render as light-yellow pending cells alongside real data */
  stagedColumns?: StagedColumn[];
  /** Visual mode for staged cells when pipeline is queued/running */
  stagedCellMode?: 'idle' | 'scheduled' | 'running';
  /** The output these cells come from; lets a typed cell open its full view. */
  refId?: string;
}

export default function DataOutputGrid({
  cells = [],
  onCellClick,
  wiringMode = false,
  onPick,
  highlight = null,
  stagedColumns = [],
  stagedCellMode = 'idle',
  refId,
}: DataOutputGridProps) {
  const [hoveredCol, setHoveredCol] = useState<string | null>(null);
  // The typed cell whose full view is open, if any.
  const [viewing, setViewing] = useState<{ row: number; column: string } | null>(null);
  const canOpen = (cell?: Cell) => !!cell?.cell_type && !!refId && !wiringMode;
  const viewer = viewing && refId ? (
    <CellViewer refId={refId} row={viewing.row} column={viewing.column} onClose={() => setViewing(null)} />
  ) : null;
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  // Cells aren't pickable yet (they need rows AND columns, core 005 K9), so
  // only the setter is used — kept for when they are.
  const [, setHoveredCell] = useState<string | null>(null);

  // Memoize grid structure calculation
  const { cols, rows, gridData, structureType, stagedColNames, stagedData } = useMemo(() => {
    const safeCells = cells ?? [];

    // Build staged lookup: "rowIndex:colName" -> staged metadata
    const sColNames: string[] = [];
    const sData: Record<string, { formula: string; state: string }> = {};
    for (const sc of stagedColumns) {
      if (!sColNames.includes(sc.name)) sColNames.push(sc.name);
      for (const cell of sc.cells) {
        sData[`${cell.rowIndex}:${sc.name}`] = {
          formula: cell.formula,
          state: cell.state,
        };
      }
    }

    if (safeCells.length === 0 && sColNames.length === 0) {
      return { cols: [], rows: [], gridData: {}, structureType: 'empty', stagedColNames: [], stagedData: {} };
    }

    const uniqueCols = Array.from(new Set(safeCells.map((c) => c.column_id)));
    const uniqueRows = Array.from(new Set(safeCells.map((c) => c.row_id))).sort(
      (a, b) => a - b
    );

    // Merge staged column names (only add ones not already in real data)
    const allCols = [...uniqueCols];
    for (const sc of sColNames) {
      if (!allCols.includes(sc)) allCols.push(sc);
    }

    // If we have staged columns but no real rows, generate row indices from staged data
    let allRows = uniqueRows;
    if (allRows.length === 0 && sColNames.length > 0 && stagedColumns[0]?.cells.length > 0) {
      allRows = Array.from({ length: stagedColumns[0].cells.length }, (_, i) => i);
    }

    // Create a lookup map for faster access: "rowId:colId" -> Cell
    const dataMap: Record<string, Cell> = {};
    safeCells.forEach((c) => {
      dataMap[`${c.row_id}:${c.column_id}`] = c;
    });

    // Determine visualization type — always use grid for tabular consistency
    const type = 'grid';

    return {
      cols: allCols,
      rows: allRows,
      gridData: dataMap,
      structureType: type,
      stagedColNames: sColNames,
      stagedData: sData,
    };
  }, [cells, stagedColumns]);

  // ── Wiring: picks ───────────────────────────────────────────────────────
  // A click while a later step's formula bar has focus picks data for it:
  // the # corner the whole table, a header a column, a row number a row.
  // Shift extends from the last pick; ⌘/Ctrl toggles one more. The receiving
  // step turns the pick into a select operation (utils/selection.ts).
  // Cells and blocks (rows AND columns) come later — core 005 K9.

  const modifiers = (e: React.MouseEvent) => ({ extend: e.shiftKey, toggle: e.metaKey || e.ctrlKey });

  const handleRowClick = (rowIndex: number, e: React.MouseEvent) => {
    if (wiringMode && onPick) onPick({ kind: 'row', row: rowIndex, order: rows, ...modifiers(e) });
  };

  const handleColumnClick = (col: string, e: React.MouseEvent) => {
    if (wiringMode && onPick) {
      onPick({ kind: 'column', column: col, order: cols, ...modifiers(e) });
      return;
    }
    onCellClick?.({ row_id: -1, column_id: col, value: col, display_value: col } as Cell);
  };

  const handleCellWireClick = (cell: Cell) => {
    if (wiringMode) return;            // single cells: later (needs rows AND columns)
    if (canOpen(cell)) setViewing({ row: cell.row_id, column: cell.column_id });
    onCellClick?.(cell);
  };

  const isColumnSelected = (col: string) =>
    !!highlight && (highlight.kind === 'all' || (highlight.kind === 'columns' && highlight.columns.includes(col)));
  const isRowSelected = (row: number) =>
    !!highlight && (highlight.kind === 'all' || (highlight.kind === 'rows' && highlight.rows.includes(row)));

  // ── Wiring overlay styles ───────────────────────────────────────────────

  const SELECTED_BG = 'rgba(255, 193, 7, 0.32)';
  const HOVER_BG = 'rgba(255, 193, 7, 0.16)';

  const wiringColHeaderStyle = (col: string): React.CSSProperties => {
    if (!wiringMode) return { cursor: 'pointer', userSelect: 'none' as const };
    return {
      cursor: 'crosshair',
      userSelect: 'none',
      background: isColumnSelected(col) ? SELECTED_BG : hoveredCol === col ? HOVER_BG : undefined,
      transition: 'background 0.1s ease',
    };
  };

  const wiringCellStyle = (key: string, col: string): React.CSSProperties => {
    const row = Number(key.split(':')[0]);
    const selected = isColumnSelected(col) || isRowSelected(row);
    if (!wiringMode) return { cursor: 'pointer', ...(selected ? { background: SELECTED_BG } : {}) };
    const hovered = hoveredCol === col || hoveredRow === row || hoveredCol === '__table__';
    return {
      cursor: 'default',
      background: selected ? SELECTED_BG : hovered ? HOVER_BG : 'transparent',
      transition: 'background 0.1s ease',
    };
  };

  // ── Empty state ─────────────────────────────────────────────────────────

  if (structureType === 'empty') {
    return (
      <div className="output-container empty">
        <div className="single-value-display empty">
          <span className="placeholder-text">Empty</span>
        </div>
      </div>
    );
  }

  // ── SCENARIO 0: the step failed — its output is one error cell ─────────
  // `errorCell()` (utils/errorCells.ts) builds it when a run or preview fails,
  // including an expression that doesn't parse.
  if (cells && cells.length === 1 && isErrorCell(cells[0])) {
    return (
      <div className="output-container error">
        <div className="error-cell" role="alert" data-testid="step-error-cell">
          {cells[0].display_value}
        </div>
      </div>
    );
  }

  // ── SCENARIO 1: Single Value (Hero Cell) ───────────────────────────────

  if (structureType === 'single-value') {
    const cell = gridData[`${rows[0]}:${cols[0]}`];
    return (
      <div className="output-container single">
        <div
          className={`single-value-display${canOpen(cell) ? ' openable' : ''}`}
          onClick={() => {
            if (cell) handleCellWireClick(cell);
          }}
          title={canOpen(cell) ? 'Click to open' : 'Click to inspect'}
          style={{}}
        >
          {cell ? <CellContent cell={cell} /> : ''}
        </div>
        {viewer}
      </div>
    );
  }

  // ── SCENARIO 2 & 3: List or Grid ──────────────────────────────────────

  return (
    <div className="output-container grid-wrapper">
      {/* Wiring mode banner */}

      <div
        className={`op-data-grid${wiringMode ? ' wiring-source' : ''}`}
        style={{
          gridTemplateColumns: `50px repeat(${cols.length}, minmax(100px, 1fr))`,
          ...(wiringMode
            ? {
                outline: '1px solid rgba(255, 193, 7, 0.6)',
                outlineOffset: -1,
                borderRadius: 3,
              }
            : {}),
        }}
        role="grid"
      >
        {/* Header Row */}
        <div
          className="grid-header-cell row-index-header"
          title={wiringMode ? 'Select the whole table' : '#'}
          style={wiringMode ? {
            cursor: 'crosshair',
            background: highlight?.kind === 'all' ? SELECTED_BG : hoveredCol === '__table__' ? HOVER_BG : undefined,
            transition: 'background 0.1s ease',
          } : {}}
          onClick={() => {
            if (wiringMode && onPick) onPick({ kind: 'all' });
          }}
          onMouseEnter={() => wiringMode && setHoveredCol('__table__')}
          onMouseLeave={() => wiringMode && setHoveredCol(null)}
        >
          #
        </div>
        {cols.map((col) => (
          <div
            key={col}
            className="grid-header-cell"
            role="columnheader"
            title={wiringMode ? `Select column ${col} (Shift: range, ⌘/Ctrl: add)` : col}
            style={{
              ...wiringColHeaderStyle(col),
              ...(stagedColNames.includes(col) ? { background: '#fff8dc', color: '#665e30' } : {}),
            }}
            onClick={(e) => handleColumnClick(col, e)}
            onMouseEnter={() => wiringMode && setHoveredCol(col)}
            onMouseLeave={() => wiringMode && setHoveredCol(null)}
          >
            {col}
          </div>
        ))}

        {/* Data Rows */}
        {rows.map((r) => (
          <div key={r} className="grid-row" role="row">
            {/* Row Number — in wiring mode this selects the whole row */}
            <div
              className="grid-cell row-index"
              title={wiringMode ? `Select row ${r} (Shift: range, ⌘/Ctrl: add)` : `row ${r}`}
              style={wiringMode ? {
                cursor: 'crosshair',
                background: isRowSelected(r) ? SELECTED_BG : hoveredRow === r ? HOVER_BG : undefined,
                transition: 'background 0.1s ease',
              } : {}}
              onClick={(e) => handleRowClick(r, e)}
              onMouseEnter={() => wiringMode && setHoveredRow(r)}
              onMouseLeave={() => wiringMode && setHoveredRow(null)}
            >
              {r}
            </div>

            {/* Cells */}
            {cols.map((c) => {
              const cell = gridData[`${r}:${c}`];
              const cellKey = `${r}:${c}`;
              const stagedInfo = stagedData[cellKey];
              const isStaged = stagedInfo !== undefined && stagedColNames.includes(c);

              if (isStaged) {
                const isError = stagedInfo.state === 'error';
                const showSpinner = !isError && (stagedCellMode === 'running' || stagedCellMode === 'scheduled');
                const modeLabel = stagedCellMode === 'running'
                  ? 'running'
                  : stagedCellMode === 'scheduled'
                    ? 'scheduled'
                    : 'staged';
                return (
                  <div
                    key={cellKey}
                    className="grid-cell staged"
                    role="gridcell"
                    title={stagedInfo.formula}
                    style={{
                      background: isError ? '#ffebee' : '#fffde7',
                      borderLeft: showSpinner ? '2px solid #ffb300' : undefined,
                    }}
                  >
                    <span
                      style={{
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        color: isError ? '#b71c1c' : '#b8960c',
                        marginRight: 6,
                        fontStyle: 'italic',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      {showSpinner && <span className="cell-wait-spinner" />}
                      ({modeLabel})
                    </span>
                    <span
                      style={{
                        color: isError ? '#8e0000' : '#7a6e30',
                        fontSize: '0.72rem',
                        fontFamily: 'Menlo, Monaco, Consolas, monospace',
                      }}
                    >
                      {stagedInfo.formula}
                    </span>
                  </div>
                );
              }

              return (
                <div
                  key={cellKey}
                  className={`grid-cell ${cell ? 'has-value' : 'empty'}${isErrorCell(cell) ? ' error-cell' : ''}${canOpen(cell) ? ' openable' : ''}`}
                  role="gridcell"
                  onClick={() => cell && handleCellWireClick(cell)}
                  title={canOpen(cell) ? `${cell?.summary ?? ''} — click to open` : (cell?.display_value ?? '')}
                  style={wiringCellStyle(cellKey, c)}
                  onMouseEnter={() => {
                    if (wiringMode) {
                      setHoveredCell(cellKey);
                      setHoveredCol(c);
                    }
                  }}
                  onMouseLeave={() => {
                    if (wiringMode) {
                      setHoveredCell(null);
                      setHoveredCol(null);
                    }
                  }}
                >
                  {cell ? <CellContent cell={cell} /> : ''}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="grid-footer">
        {rows.length} row{rows.length !== 1 ? 's' : ''}, {cols.length} column
        {cols.length !== 1 ? 's' : ''}

      </div>
      {viewer}
    </div>
  );
}

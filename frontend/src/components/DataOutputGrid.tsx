import { useMemo, useState } from 'react';
import type { Cell } from '../types/models';
import type { StagedColumn } from '../hooks/useStagedPreview';
import './OperationColumn.css'; // Ensure grid styles are available

interface DataOutputGridProps {
  cells?: Cell[];
  onCellClick?: (cell: Cell) => void;
  wiringMode?: boolean;
  sourceStepId?: string;
  onWireColumn?: (token: string) => void;
  onWireCell?: (token: string) => void;
  /** Staged columns to render as light-yellow pending cells alongside real data */
  stagedColumns?: StagedColumn[];
}

// Wiring banner styles
const WIRING_BANNER: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 8px',
  background: 'linear-gradient(90deg, #fff3cd 0%, #fff8e1 100%)',
  borderBottom: '1px solid #ffc107',
  fontSize: '0.72rem',
  color: '#856404',
  fontWeight: 600,
  letterSpacing: '0.02em',
};

export default function DataOutputGrid({
  cells = [],
  onCellClick,
  wiringMode = false,
  sourceStepId = '',
  onWireColumn,
  onWireCell,
  stagedColumns = [],
}: DataOutputGridProps) {
  const [hoveredCol, setHoveredCol] = useState<string | null>(null);
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);

  // Memoize grid structure calculation
  const { cols, rows, gridData, structureType, stagedColNames, stagedData } = useMemo(() => {
    const safeCells = cells ?? [];

    // Build staged lookup: "rowIndex:colName" -> formula string
    const sColNames: string[] = [];
    const sData: Record<string, string> = {};
    for (const sc of stagedColumns) {
      if (!sColNames.includes(sc.name)) sColNames.push(sc.name);
      for (const cell of sc.cells) {
        sData[`${cell.rowIndex}:${sc.name}`] = cell.formula;
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

    // Determine visualization type
    let type = 'grid';
    if (allRows.length === 1 && allCols.length === 1 && sColNames.length === 0) {
      type = 'single-value';
    } else if (allCols.length === 1 && sColNames.length === 0) {
      type = 'list';
    }

    return {
      cols: allCols,
      rows: allRows,
      gridData: dataMap,
      structureType: type,
      stagedColNames: sColNames,
      stagedData: sData,
    };
  }, [cells, stagedColumns]);

  // ── Wiring helpers ──────────────────────────────────────────────────────

  const handleColumnClick = (col: string) => {
    if (wiringMode && onWireColumn) {
      onWireColumn(`${sourceStepId}.${col}`);
      return;
    }
  };

  const handleCellWireClick = (cell: Cell) => {
    if (wiringMode && onWireCell) {
      onWireCell(`${sourceStepId}[row=${cell.row_id}, col=${cell.column_id}]`);
      return;
    }
    onCellClick?.(cell);
  };

  // ── Wiring overlay styles ───────────────────────────────────────────────

  const wiringColHeaderStyle = (col: string): React.CSSProperties => {
    if (!wiringMode) return {};
    const isHovered = hoveredCol === col;
    return {
      cursor: 'crosshair',
      background: isHovered
        ? 'linear-gradient(135deg, #ffc107 0%, #ffecb3 100%)'
        : 'linear-gradient(135deg, #fff8e1 0%, #fffde7 100%)',
      color: isHovered ? '#5d4037' : '#7b5e00',
      borderBottom: isHovered ? '2px solid #ffa000' : '2px solid #ffd54f',
      fontWeight: 700,
      transition: 'all 0.1s ease',
      userSelect: 'none',
    };
  };

  const wiringCellStyle = (key: string, col: string): React.CSSProperties => {
    if (!wiringMode) return {};
    const colHovered = hoveredCol === col;
    const cellHovered = hoveredCell === key;
    return {
      cursor: 'crosshair',
      background: cellHovered
        ? '#fff3cd'
        : colHovered
        ? 'rgba(255, 224, 102, 0.25)'
        : 'transparent',
      outline: cellHovered ? '1px dashed #ffa000' : 'none',
      transition: 'background 0.1s ease',
    };
  };

  // ── Empty state ─────────────────────────────────────────────────────────

  if (structureType === 'empty') {
    return (
      <div className="output-container empty">
        {wiringMode && (
          <div style={WIRING_BANNER}>
            <span>⚡</span> No data yet — run this step first to wire its output
          </div>
        )}
        <div className="single-value-display empty">
          <span className="placeholder-text">Empty</span>
        </div>
      </div>
    );
  }

  // ── SCENARIO 1: Single Value (Hero Cell) ───────────────────────────────

  if (structureType === 'single-value') {
    const cell = gridData[`${rows[0]}:${cols[0]}`];
    return (
      <div className="output-container single">
        {wiringMode && (
          <div style={WIRING_BANNER}>
            <span>⚡</span> Click value to use as argument
          </div>
        )}
        <div
          className="single-value-display"
          onClick={() => {
            if (wiringMode && cell && onWireCell) {
              onWireCell(`${sourceStepId}[row=${cell.row_id}, col=${cell.column_id}]`);
            } else if (cell) {
              onCellClick?.(cell);
            }
          }}
          title={
            wiringMode
              ? `Insert reference: ${sourceStepId}[row=${rows[0]}, col=${cols[0]}]`
              : 'Click to inspect'
          }
          style={
            wiringMode
              ? { cursor: 'crosshair', outline: '2px dashed #ffc107', background: '#fffde7' }
              : {}
          }
        >
          {cell ? cell.display_value : ''}
        </div>
      </div>
    );
  }

  // ── SCENARIO 2 & 3: List or Grid ──────────────────────────────────────

  return (
    <div className="output-container grid-wrapper">
      {/* Wiring mode banner */}
      {wiringMode && (
        <div style={WIRING_BANNER}>
          <span>⚡</span> Click{' '}
          <span
            style={{
              background: '#e8f5e9',
              color: '#2e7d32',
              borderRadius: 3,
              padding: '0 4px',
              fontWeight: 700,
            }}
          >
            #
          </span>{' '}
          for the whole table, a{' '}
          <span
            style={{
              background: '#ffc107',
              color: '#5d4037',
              borderRadius: 3,
              padding: '0 4px',
              fontWeight: 700,
            }}
          >
            column header
          </span>{' '}
          for a column, or a{' '}
          <span
            style={{
              background: '#ffe082',
              color: '#5d4037',
              borderRadius: 3,
              padding: '0 4px',
              fontWeight: 700,
            }}
          >
            cell
          </span>{' '}
          for a specific value
        </div>
      )}

      <div
        className={`op-data-grid${wiringMode ? ' wiring-source' : ''}`}
        style={{
          gridTemplateColumns: `50px repeat(${cols.length}, minmax(100px, 1fr))`,
          ...(wiringMode
            ? {
                outline: '2px dashed #ffc107',
                outlineOffset: -2,
                borderRadius: 4,
              }
            : {}),
        }}
        role="grid"
      >
        {/* Header Row */}
        <div
          className="grid-header-cell row-index-header"
          title={wiringMode ? `⚡ Insert entire table reference: ${sourceStepId}` : '#'}
          style={wiringMode ? {
            cursor: 'crosshair',
            background: hoveredCol === '__table__' ? '#c8e6c9' : undefined,
            transition: 'background 0.1s ease',
          } : {}}
          onClick={() => {
            if (wiringMode && onWireColumn) {
              onWireColumn(sourceStepId);
            }
          }}
          onMouseEnter={() => wiringMode && setHoveredCol('__table__')}
          onMouseLeave={() => wiringMode && setHoveredCol(null)}
        >
          {wiringMode ? '⚡ #' : '#'}
        </div>
        {cols.map((col) => (
          <div
            key={col}
            className="grid-header-cell"
            role="columnheader"
            title={
              wiringMode
                ? `⚡ Insert column reference: ${sourceStepId}.${col}`
                : col
            }
            style={{
              ...wiringColHeaderStyle(col),
              ...(stagedColNames.includes(col) ? { background: '#fff8dc', color: '#665e30' } : {}),
            }}
            onClick={() => handleColumnClick(col)}
            onMouseEnter={() => wiringMode && setHoveredCol(col)}
            onMouseLeave={() => wiringMode && setHoveredCol(null)}
          >
            {wiringMode && (
              <span
                style={{
                  fontSize: '0.6rem',
                  marginRight: 3,
                  opacity: hoveredCol === col ? 1 : 0.6,
                }}
              >
                ⚡
              </span>
            )}
            {col}
          </div>
        ))}

        {/* Data Rows */}
        {rows.map((r) => (
          <div key={r} className="grid-row" role="row">
            {/* Row Number */}
            <div className="grid-cell row-index">{r + 1}</div>

            {/* Cells */}
            {cols.map((c) => {
              const cell = gridData[`${r}:${c}`];
              const cellKey = `${r}:${c}`;
              const staged = stagedData[cellKey];
              const isStaged = staged !== undefined && stagedColNames.includes(c);

              if (isStaged) {
                return (
                  <div
                    key={cellKey}
                    className="grid-cell staged"
                    role="gridcell"
                    title={staged}
                    style={{ background: '#fffde7' }}
                  >
                    <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#b8960c', marginRight: 6, fontStyle: 'italic' }}>(staged)</span>
                    <span style={{ color: '#7a6e30', fontSize: '0.72rem', fontFamily: 'Menlo, Monaco, Consolas, monospace' }}>{staged}</span>
                  </div>
                );
              }

              return (
                <div
                  key={cellKey}
                  className={`grid-cell ${cell ? 'has-value' : 'empty'}`}
                  role="gridcell"
                  onClick={() => cell && handleCellWireClick(cell)}
                  title={
                    wiringMode && cell
                      ? `⚡ Insert: ${sourceStepId}[row=${r}, col=${c}]`
                      : cell?.display_value ?? ''
                  }
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
                  {cell ? cell.display_value : ''}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="grid-footer">
        {rows.length} row{rows.length !== 1 ? 's' : ''}, {cols.length} column
        {cols.length !== 1 ? 's' : ''}
        {wiringMode && (
          <span style={{ marginLeft: 8, color: '#ffa000', fontSize: '0.7rem' }}>
            ⚡ wiring active
          </span>
        )}
      </div>
    </div>
  );
}

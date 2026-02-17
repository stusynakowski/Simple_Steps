import { useMemo } from 'react';
import type { Cell } from '../types/models';
import './OperationColumn.css'; // Ensure grid styles are available

interface DataOutputGridProps {
  cells?: Cell[];
  onCellClick?: (cell: Cell) => void;
}

export default function DataOutputGrid({ cells = [], onCellClick }: DataOutputGridProps) {
  // Memoize grid structure calculation
  const { cols, rows, gridData, structureType } = useMemo(() => {
    const safeCells = cells ?? [];
    
    if (safeCells.length === 0) {
      return { cols: [], rows: [], gridData: {}, structureType: 'empty' };
    }

    const uniqueCols = Array.from(new Set(safeCells.map((c) => c.column_id)));
    const uniqueRows = Array.from(new Set(safeCells.map((c) => c.row_id))).sort((a, b) => a - b);
    
    // Create a lookup map for faster access: "rowId:colId" -> Cell
    const dataMap: Record<string, Cell> = {};
    safeCells.forEach(c => {
      dataMap[`${c.row_id}:${c.column_id}`] = c;
    });

    // Determine visualization type
    let type = 'grid';
    if (uniqueRows.length === 1 && uniqueCols.length === 1) {
      type = 'single-value';
    } else if (uniqueCols.length === 1) {
      type = 'list';
    }

    return { 
      cols: uniqueCols, 
      rows: uniqueRows, 
      gridData: dataMap,
      structureType: type
    };
  }, [cells]);

  if (structureType === 'empty') {
    return (
      <div className="output-container empty">
        <div className="single-value-display empty">
           <span className="placeholder-text">Empty</span>
        </div>
      </div>
    );
  }

  // SCENARIO 1: Single Value (Hero Cell)
  if (structureType === 'single-value') {
    const cell = gridData[`${rows[0]}:${cols[0]}`];
    return (
      <div className="output-container single">
        <div 
          className="single-value-display"
          onClick={() => cell && onCellClick?.(cell)}
          title="Click to inspect"
        >
          {cell ? cell.display_value : ''}
        </div>
      </div>
    );
  }

  // SCENARIO 2 & 3: List or Grid
  return (
    <div className="output-container grid-wrapper">
      <div 
        className="op-data-grid"
        style={{ 
          gridTemplateColumns: `50px repeat(${cols.length}, minmax(100px, 1fr))`
        }}
        role="grid"
      >
        {/* Header Row */}
        <div className="grid-header-cell row-index-header">#</div>
        {cols.map((col) => (
          <div key={col} className="grid-header-cell" role="columnheader" title={col}>
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
              return (
                <div
                  key={`${r}-${c}`}
                  className={`grid-cell ${cell ? 'has-value' : 'empty'}`}
                  role="gridcell"
                  onClick={() => cell && onCellClick?.(cell)}
                  title={cell ? cell.display_value : ''}
                >
                  {cell ? cell.display_value : ''}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="grid-footer">
        {rows.length} row{rows.length !== 1 ? 's' : ''}, {cols.length} column{cols.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

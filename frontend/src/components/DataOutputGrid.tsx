import type { Cell } from '../types/models';

interface DataOutputGridProps {
  cells?: Cell[];
  onCellClick?: (cell: Cell) => void;
}

export default function DataOutputGrid({ cells = [], onCellClick }: DataOutputGridProps) {
  const preview = cells ?? [];
  const cols = Array.from(new Set(preview.map((c) => c.column_id)));
  const rows = Array.from(new Set(preview.map((c) => c.row_id))).sort((a, b) => a - b);

  function cellValue(row: number, col: string) {
    const found = preview.find((c) => c.row_id === row && c.column_id === col);
    return found ?? null;
  }

  return (
    <div className="output" data-testid="step-output">
      {cols.length === 0 || rows.length === 0 ? (
        <div data-testid="no-outputs" className="no-outputs">No outputs yet</div>
      ) : (
        <div className="grid" role="grid" data-testid="output-grid">
          <div className="row header" role="row">
            <div className="cell header" role="columnheader"></div>
            {cols.map((col) => (
              <div key={col} className="cell header" role="columnheader">
                {col}
              </div>
            ))}
          </div>

          {rows.map((r) => (
            <div key={r} className="row" role="row">
              <div className="cell row-label">{r}</div>
              {cols.map((c) => {
                const val = cellValue(r, c);
                return (
                  <div
                    key={`${r}-${c}`}
                    className={`cell ${val ? 'has-value' : 'empty'}`}
                    role="gridcell"
                    data-testid={`cell-${r}-${c}`}
                    onClick={() => val && onCellClick?.(val as Cell)}
                  >
                    {val ? (val as Cell).display_value : ''}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

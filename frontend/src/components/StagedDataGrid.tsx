import type { StagedPreview } from '../hooks/useStagedPreview';
import './StagedDataGrid.css';

interface StagedDataGridProps {
  preview: StagedPreview;
}

export default function StagedDataGrid({ preview }: StagedDataGridProps) {
  if (!preview.columns.length) {
    return null;
  }

  const rowCount = preview.columns[0]?.cells.length ?? 0;

  return (
    <div className="staged-data-grid">
      {/* Global errors — keep these, they're useful */}
      {preview.globalErrors.length > 0 && (
        <div className="staged-global-errors">
          {preview.globalErrors.map((err, i) => (
            <div key={i} className="staged-global-error">
              <span>⚠</span> {err}
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="staged-table-wrapper">
        <table className="staged-table">
          <thead>
            <tr>
              <th className="staged-row-index">#</th>
              {preview.columns.map((col) => (
                <th key={col.name} className="staged-col-header">
                  {col.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_, rowIdx) => (
              <tr key={rowIdx}>
                <td className="staged-row-index">{rowIdx + 1}</td>
                {preview.columns.map((col) => {
                  const cell = col.cells[rowIdx];
                  return (
                    <td
                      key={col.name}
                      className="staged-cell"
                      title={cell.formula}
                    >
                      <span className="staged-tag">(staged)</span>
                      <span className="staged-cell-text">{cell.formula}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

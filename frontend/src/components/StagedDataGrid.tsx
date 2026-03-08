import type { StagedPreview, StagedCell } from '../hooks/useStagedPreview';
import './StagedDataGrid.css';

interface StagedDataGridProps {
  preview: StagedPreview;
}

function CellBadge({ cell }: { cell: StagedCell }) {
  return (
    <td
      className={`staged-cell staged-cell--${cell.state}`}
      title={cell.errorMessage ?? cell.formula}
    >
      <span className="staged-cell-text">{cell.displayValue}</span>
    </td>
  );
}

export default function StagedDataGrid({ preview }: StagedDataGridProps) {
  if (!preview.columns.length && !preview.globalErrors.length) {
    return (
      <div className="staged-grid-empty">
        <span className="staged-grid-empty-icon">⬡</span>
        <span>{preview.description || 'No preview available yet.'}</span>
      </div>
    );
  }

  const rowCount = preview.columns[0]?.cells.length ?? 0;

  return (
    <div className="staged-data-grid">
      {/* Description bar */}
      {preview.description && (
        <div
          className={`staged-description ${
            preview.isReady ? 'ready' : preview.globalErrors.length ? 'error' : 'pending'
          }`}
        >
          <span className="staged-description-icon">
            {preview.isReady ? '✓' : preview.globalErrors.length ? '⚠' : '…'}
          </span>
          {preview.description}
        </div>
      )}

      {/* Global errors */}
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
      {preview.columns.length > 0 && (
        <div className="staged-table-wrapper">
          <table className="staged-table">
            <thead>
              <tr>
                <th className="staged-row-index">#</th>
                {preview.columns.map((col) => (
                  <th
                    key={col.name}
                    className={`staged-col-header${col.isNew ? ' col-new' : ''}${col.isPassthrough ? ' col-passthrough' : ''}`}
                    title={
                      col.isNew
                        ? 'New column produced by this operation'
                        : 'Passed through from upstream'
                    }
                  >
                    <span className="col-header-label">{col.name}</span>
                    {col.isNew && <span className="col-badge col-badge--new">new</span>}
                    {col.isPassthrough && <span className="col-badge col-badge--pass">↳</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rowCount }, (_, rowIdx) => (
                <tr key={rowIdx}>
                  <td className="staged-row-index">{rowIdx + 1}</td>
                  {preview.columns.map((col) => (
                    <CellBadge key={col.name} cell={col.cells[rowIdx]} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

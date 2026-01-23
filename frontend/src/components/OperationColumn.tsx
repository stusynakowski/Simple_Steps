import { useState } from 'react';
import type { Step } from '../types/models';
import './OperationColumn.css';

interface OperationColumnProps {
  step: Step;
  isActive: boolean;
  onActivate: (id: string) => void;
  onRun: (id: string) => void;
  onPause: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function OperationColumn({
  step,
  isActive,
  onActivate,
  onRun,
  onPause,
  onDelete,
}: OperationColumnProps) {
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const [statusExpanded, setStatusExpanded] = useState(true);

  // If the column is not active, treat expanders as collapsed 
  // (unless we want them to remember state, but spec says "minimize other operations")
  const isDetailsVisible = isActive && detailsExpanded;
  const isStatusVisible = isActive && statusExpanded;

  const handleColumnClick = () => {
    if (!isActive) {
      onActivate(step.id);
    }
  };

  return (
    <div
      className={`operation-column ${isActive ? 'active' : 'inactive'} status-${step.status}`}
      onClick={handleColumnClick}
      data-testid={`operation-column-${step.id}`}
    >
      <div className="op-header">
        <h3 className="op-name">{step.label}</h3>
        <div className="op-status-indicator">{step.status}</div>
      </div>

      <div className={`op-toolbar ${isActive ? 'visible' : 'hidden'}`}>
        <button className="btn-icon" onClick={(e) => { e.stopPropagation(); onRun(step.id); }} title="Run">
          ▶
        </button>
        <button className="btn-icon" onClick={(e) => { e.stopPropagation(); onPause(step.id); }} title="Pause">
          ⏸
        </button>
        <button className="btn-icon danger" onClick={(e) => { e.stopPropagation(); onDelete(step.id); }} title="Delete">
          🗑
        </button>
      </div>

      {isActive && (
        <div className="op-expander-section">
          <div
            className="expander-header"
            onClick={(e) => { e.stopPropagation(); setDetailsExpanded(!detailsExpanded); }}
          >
            {detailsExpanded ? '▼' : '▶'} Operation Details
          </div>
          {isDetailsVisible && (
            <div className="expander-content details-content">
              <div className="config-item">
                <label>Type:</label>
                <span>{step.process_type}</span>
              </div>
              <div className="config-item">
                <label>Params:</label>
                <div className="json-preview">{JSON.stringify(step.configuration)}</div>
              </div>
            </div>
          )}

          <div
            className="expander-header"
            onClick={(e) => { e.stopPropagation(); setStatusExpanded(!statusExpanded); }}
          >
            {statusExpanded ? '▼' : '▶'} Status Details
          </div>
          {isStatusVisible && (
            <div className="expander-content status-content">
               <p>Execution ID: {step.id.substring(0, 8)}</p>
               {/* Placeholder for logs/timings */}
            </div>
          )}
        </div>
      )}

      <div className="op-data-column">
        {step.output_preview && step.output_preview.length > 0 ? (
           // We reuse DataOutputGrid but styled vertically effectively by its container
           // Or we could implement a simpler list if a grid isn't desired.
           // For now, let's keep it simple: A list of values
           <div className="data-list">
             {step.output_preview.map((cell) => (
               <div key={`${cell.row_id}-${cell.column_id}`} className="data-cell-item">
                 {cell.display_value}
               </div>
             ))}
           </div>
        ) : (
          <div className="no-data-placeholder">No Data</div>
        )}
      </div>
    </div>
  );
}

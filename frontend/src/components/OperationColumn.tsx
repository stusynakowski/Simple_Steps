import { useState } from 'react';
import type { Step } from '../types/models';
import './OperationColumn.css';

interface OperationColumnProps {
  step: Step;
  color?: string;
  isActive: boolean;
  isSqueezed?: boolean;
  zIndex?: number;
  onActivate: (id: string) => void;
  onRun: (id: string) => void;
  onPause: (id: string) => void;
  onDelete: (id: string) => void;
  onMinimize?: () => void;
}

export default function OperationColumn({
  step,
  color = '#444', 
  isActive,
  isSqueezed = false,
  zIndex = 1,
  onActivate,
  onRun,
  onPause,
  onDelete,
  onMinimize,
}: OperationColumnProps) {
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const [statusExpanded, setStatusExpanded] = useState(true);

  const handleColumnClick = () => {
    // Toggling behavior handled by parent's onActivate = toggleStep
    onActivate(step.id);
  };

  return (
    <div
      className={`operation-column ${isActive ? 'active' : ''} ${isSqueezed ? 'squeezed' : ''} status-${step.status}`}
      style={{ 
        '--step-color': color,
        zIndex: zIndex 
      } as React.CSSProperties}
      onClick={handleColumnClick}
      data-testid={`operation-column-${step.id}`}
    >
      <div className="op-header">
        <div className="arrow-background" />
        <div className="arrow-content">
            {isSqueezed ? (
                 <span className="vertical-label">{step.label}</span>
            ) : (
                <>
                    <div className="header-titles">
                        <h3 className="op-name">{step.label}</h3>
                        <span className="op-status-indicator">{step.status}</span>
                    </div>
                    {isActive && onMinimize && (
                        <button 
                            className="btn-minimize"
                            onClick={(e) => { e.stopPropagation(); onMinimize(); }}
                            title="Minimize"
                        >
                            _
                        </button>
                    )}
                </>
            )}
        </div>
      </div>


      <div className={`op-body ${isSqueezed ? 'squeezed' : ''}`}>
        <div className="op-body-inner">
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
              <div className={`expander-content details-content ${detailsExpanded ? 'expanded' : ''}`}>
                <div className="expander-inner">
                  <div className="config-item">
                    <label>Type:</label>
                    <span>{step.process_type}</span>
                  </div>
                  <div className="config-item">
                    <label>Params:</label>
                    <div className="json-preview">{JSON.stringify(step.configuration)}</div>
                  </div>
                </div>
              </div>

              <div
                className="expander-header"
                onClick={(e) => { e.stopPropagation(); setStatusExpanded(!statusExpanded); }}
              >
                {statusExpanded ? '▼' : '▶'} Status Details
              </div>
              <div className={`expander-content status-content ${statusExpanded ? 'expanded' : ''}`}>
                <div className="expander-inner">
                  <p>Execution ID: {step.id.substring(0, 8)}</p>
                </div>
              </div>
            </div>
          )}

          <div className="op-data-column">
            {step.output_preview && step.output_preview.length > 0 ? (
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
      </div>
    </div>
  );
}

import { useState } from 'react';
import type { Step } from '../types/models';
import type { OperationDefinition } from '../services/api';
import './OperationColumn.css';

interface OperationColumnProps {
  step: Step;
  availableOperations?: OperationDefinition[];
  color?: string;
  isActive: boolean;
  isSqueezed?: boolean;
  zIndex?: number;
  onActivate: (id: string) => void;
  onUpdate?: (id: string, updates: Partial<Step>) => void;
  onRun: (id: string) => void;
  onPause: (id: string) => void;
  onDelete: (id: string) => void;
  onMinimize?: () => void;
}

export default function OperationColumn({
  step,
  availableOperations = [],
  color = '#444', 
  isActive,
  isSqueezed = false,
  zIndex = 1,
  onActivate,
  onUpdate,
  onRun,
  onPause,
  onDelete,
  onMinimize,
}: OperationColumnProps) {
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const [statusExpanded, setStatusExpanded] = useState(true);
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const [isEditMode, setIsEditMode] = useState(true);

  const currentOp = availableOperations.find(op => op.id === step.process_type);
  const hasParams = currentOp && currentOp.params && currentOp.params.length > 0;

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
            
            <div style={{ flex: 1 }} /> {/* Spacer */}

            <button 
                className={`btn-pill-toggle ${isEditMode ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setIsEditMode(!isEditMode); }}
                title="Toggle Edit Mode"
            >
                Edit Step
            </button>

            {isEditMode && (
                <button className="btn-icon danger" onClick={(e) => { e.stopPropagation(); onDelete(step.id); }} title="Delete">
                🗑
                </button>
            )}
          </div>

          {isActive && (
            <div className="op-expander-section">
              {/* Summary Section (Moved to Top) */}
              <div
                className="expander-header"
                onClick={(e) => { e.stopPropagation(); setSummaryExpanded(!summaryExpanded); }}
              >
                {summaryExpanded ? '▼' : '▶'} Summary
              </div>
              <div className={`expander-content summary-content ${summaryExpanded ? 'expanded' : ''}`}>
                <div className="expander-inner" onClick={(e) => e.stopPropagation()}>
                   <div className="config-item">
                      <label>Step Name</label>
                      <input 
                        type="text" 
                        value={step.label} 
                        onChange={(e) => onUpdate?.(step.id, { label: e.target.value })}
                        placeholder="Enter step name..."
                        disabled={!isEditMode}
                        style={{ opacity: isEditMode ? 1 : 0.8, cursor: isEditMode ? 'text' : 'default'  }}
                      />
                   </div>
                   <div className="summary-item">
                      <span className="label">Operation:</span>
                      <span>{currentOp?.label || step.process_type}</span>
                   </div>
                   <div className="summary-item">
                      <span className="label">Status:</span>
                      <span className={`status-badge status-${step.status}`}>{step.status}</span>
                   </div>
                </div>
              </div>

              {/* Operation Details Section */}
              {isEditMode && (
              <>
              <div
                className="expander-header"
                onClick={(e) => { e.stopPropagation(); setDetailsExpanded(!detailsExpanded); }}
              >
                {detailsExpanded ? '▼' : '▶'} Operation Details
              </div>
              <div className={`expander-content details-content ${detailsExpanded ? 'expanded' : ''}`}>
                <div className="expander-inner" onClick={(e) => e.stopPropagation()}>
                  <div className="config-item">
                    <label>Type:</label>
                    <select 
                        value={step.process_type} 
                        onChange={(e) => {
                            const newOpId = e.target.value;
                            onUpdate?.(step.id, { 
                                process_type: newOpId,
                                configuration: {} // Reset config on change
                            });
                        }}
                        disabled={!isActive}
                    >
                        <option value="noop">Select Operation...</option>
                        {availableOperations.map(op => (
                            <option key={op.id} value={op.id}>{op.label}</option>
                        ))}
                    </select>
                  </div>
                  
                  {hasParams && currentOp?.params.map(param => (
                    <div key={param.name} className="config-item">
                      <label>{param.name}:</label>
                      <input 
                          type={param.type === 'number' ? 'number' : 'text'}
                          value={String(step.configuration[param.name] ?? (param.default || ''))}
                          onChange={(e) => {
                              const val = param.type === 'number' ? Number(e.target.value) : e.target.value;
                              onUpdate?.(step.id, {
                                  configuration: { ...step.configuration, [param.name]: val }
                              });
                          }}
                          title={param.description}
                          placeholder={String(param.default || '')}
                      />
                    </div>
                  ))}
                </div>
              </div>
              </>
              )}

              {/* Data Section */}
              <div
                className="expander-header"
                onClick={(e) => { e.stopPropagation(); setStatusExpanded(!statusExpanded); }}
              >
                {statusExpanded ? '▼' : '▶'} Data
              </div>
              <div className={`expander-content status-content ${statusExpanded ? 'expanded' : ''}`}>
                <div className="expander-inner" onClick={(e) => e.stopPropagation()}>
                  <p style={{ margin: '0 0 10px 0', fontSize: '0.75rem', color: '#666' }}>
                    Execution ID: {step.id.substring(0, 8)}
                  </p>
                  
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
          )}
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import type { Step } from '../types/models';
import type { OperationDefinition } from '../services/api';
import DataOutputGrid from './DataOutputGrid';
import StepToolbar from './StepToolbar';
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
  onPreview?: (id: string) => void;
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
  onPreview,
  onDelete,
  onMinimize,
}: OperationColumnProps) {
  // Toggle Visibility ("Is it enabled/added to view?")
  const [detailsVisible, setDetailsVisible] = useState(false); // Hidden by default
  const [statusVisible, setStatusVisible] = useState(true); // Shown by default
  const [summaryVisible, setSummaryVisible] = useState(false); // Hidden by default

  // Expander State ("Is it collapsed/minimized?")
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const [statusExpanded, setStatusExpanded] = useState(true);
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  
  const [isEditMode] = useState(true); // Always true since toggle removed

  const currentOp = availableOperations.find(op => op.id === step.process_type);
  const hasParams = currentOp && currentOp.params && currentOp.params.length > 0;

  // Calculate display name for the operation summary
  const getOperationDisplayName = () => {
    if (!step.process_type || step.process_type === 'noop') return 'None';
    if (currentOp) return currentOp.label;
    return step.process_type; // Fallback to ID
  };
  const opDisplayName = getOperationDisplayName();

  const handleColumnClick = () => {
    // Only activate if not currently active (squeezed).
    // If active, do nothing. Minimization must happen via the minimize button.
    if (!isActive) {
        onActivate(step.id);
    }
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
                            className="btn-minimize square-btn"
                            onClick={(e) => { e.stopPropagation(); onMinimize(); }}
                            title="Minimize"
                            style={{ 
                                width: 24, height: 24, 
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                border: '1px solid rgba(0,0,0,0.2)', borderRadius: 4,
                                background: 'rgba(255,255,255,0.2)', cursor: 'pointer'
                            }}
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                            </svg>
                        </button>
                    )}
                </>
            )}
        </div>
      </div>


      <div className={`op-body ${isSqueezed ? 'squeezed' : ''}`}>
        <div className="op-body-inner">
          {!isSqueezed && (
            <StepToolbar 
              step={step}
              availableOperations={availableOperations}
              onRun={() => onRun(step.id)}
              onDelete={() => onDelete(step.id)}
              // Toggle Handlers (Toggle Visibility)
              onToggleConfig={() => setDetailsVisible(!detailsVisible)}
              onToggleData={() => setStatusVisible(!statusVisible)}
              onToggleSummary={() => setSummaryVisible(!summaryVisible)}
              // State (For Toolbar button active state)
              showConfig={detailsVisible}
              showData={statusVisible}
              showSummary={summaryVisible}
              onFormulaChange={(id, formula) => onUpdate?.(id, { operation: formula })}
            />
          )}

          {isActive && (
            <div className="op-expander-section">
              {/* Summary Section */}
              {summaryVisible && (
                <>
                  <div
                    className="expander-header clickable-header"
                    onClick={(e) => { e.stopPropagation(); setSummaryExpanded(!summaryExpanded); }}
                    style={{ display: 'flex', alignItems: 'center' }}
                  >
                     {summaryExpanded ? '▼' : '▶'} 
                     <span style={{ margin: '0 4px 0 8px', display: 'flex', alignItems: 'center', color: '#f39c12' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="20" x2="18" y2="10"></line>
                            <line x1="12" y1="20" x2="12" y2="4"></line>
                            <line x1="6" y1="20" x2="6" y2="14"></line>
                        </svg>
                     </span>
                     Summary
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
                          <span className="value" title={opDisplayName}>
                            {opDisplayName}
                          </span>
                       </div>
                       <div className="summary-item">
                          <span className="label">Status:</span>
                          <span className={`status-badge status-${step.status}`}>{step.status}</span>
                       </div>
                    </div>
                  </div>
                </>
              )}

              {/* Operation Details Section */}
              {detailsVisible && isEditMode && (
                <>
                  <div
                    className="expander-header clickable-header"
                    onClick={(e) => { e.stopPropagation(); setDetailsExpanded(!detailsExpanded); }}
                    style={{ display: 'flex', alignItems: 'center' }}
                  >
                     {detailsExpanded ? '▼' : '▶'}
                     <span style={{ margin: '0 4px 0 8px', display: 'flex', alignItems: 'center' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="3"></circle>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                        </svg>
                     </span>
                     Operation Details
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
                              type="text"
                              value={String(step.configuration[param.name] ?? (param.default || ''))}
                              onChange={(e) => {
                                  const val = e.target.value;
                                  // Allow Excel-like syntax starting with = to be stored as string
                                  // irrespective of the expected parameter type.
                                  const isFormula = val.startsWith('=');
                                  const updateVal = (param.type === 'number' && !isFormula) ? Number(val) : val;
                                  
                                  onUpdate?.(step.id, {
                                      configuration: { ...step.configuration, [param.name]: updateVal }
                                  });
                              }}
                              onBlur={() => {
                                  // Trigger preview on blur if available
                                  onPreview?.(step.id);
                              }}
                              onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                      onPreview?.(step.id);
                                  }
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
              {statusVisible && (
                <>
                  <div
                    className="expander-header clickable-header"
                    onClick={(e) => { e.stopPropagation(); setStatusExpanded(!statusExpanded); }}
                    style={{ display: 'flex', alignItems: 'center' }}
                  >
                     {statusExpanded ? '▼' : '▶'}
                     <span style={{ margin: '0 4px 0 8px', display: 'flex', alignItems: 'center' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                        </svg>
                     </span>
                     Data
                  </div>
                  <div className={`expander-content status-content ${statusExpanded ? 'expanded' : ''}`}>
                    <div className="expander-inner" onClick={(e) => e.stopPropagation()}>
                      <p style={{ margin: '0 0 10px 0', fontSize: '0.75rem', color: '#666' }}>
                        Execution ID: {step.id.substring(0, 8)}
                      </p>
                      
                      <DataOutputGrid 
                        cells={step.output_preview} 
                        onCellClick={(cell) => console.log('Cell clicked:', cell)}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

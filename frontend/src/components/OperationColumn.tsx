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
  isMaximized?: boolean; // New prop
  zIndex?: number;
  onActivate: (id: string) => void;
  onUpdate?: (id: string, updates: Partial<Step>) => void;
  onRun: (id: string) => void;
  onPreview?: (id: string) => void;
  onPause: (id: string) => void;
  onDelete: (id: string) => void;
  onMinimize?: () => void;
  onMaximize?: () => void; // New callback
}

export default function OperationColumn({
  step,
  availableOperations = [],
  color = '#444', 
  isActive,
  isSqueezed = false,
  isMaximized = false,
  zIndex = 1,
  onActivate,
  onUpdate,
  onRun,
  onPreview,
  onDelete,
  onMinimize,
  onMaximize,
}: OperationColumnProps) {
  // Tab State
  const [activeTab, setActiveTab] = useState<'summary' | 'details' | 'data'>('data');
  const [isEditMode] = useState(true);

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
      className={`operation-column ${isActive ? 'active' : ''} ${isMaximized ? 'maximized' : ''} ${isSqueezed ? 'squeezed' : ''} status-${step.status}`}
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
                    {isActive && onMaximize && (
                        <button 
                            className="btn-maximize square-btn"
                            onClick={(e) => { e.stopPropagation(); onMaximize(); }}
                            title={isMaximized ? "Restore" : "Maximize"}
                            style={{ 
                                width: 24, height: 24, 
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                border: '1px solid rgba(0,0,0,0.2)', borderRadius: 4,
                                background: 'rgba(255,255,255,0.2)', cursor: 'pointer',
                                marginRight: 4
                            }}
                        >
                            {isMaximized ? (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path>
                                </svg>
                            ) : (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="15 3 21 3 21 9"></polyline>
                                    <polyline points="9 21 3 21 3 15"></polyline>
                                    <line x1="21" y1="3" x2="14" y2="10"></line>
                                    <line x1="3" y1="21" x2="10" y2="14"></line>
                                </svg>
                            )}
                        </button>
                    )}
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
              activeTab={activeTab}
              onTabChange={setActiveTab}
              onFormulaChange={(id, formula) => onUpdate?.(id, { operation: formula })}
            />
          )}

          {isActive && (
            <div className={`op-content-section ${activeTab}`} style={{ 
                background: activeTab === 'summary' ? '#fef9e7' : 
                            activeTab === 'details' ? '#ebf5fb' : 
                            activeTab === 'data' ? '#f4ecf7' : '#fff',
                border: '1px solid #ddd', 
                borderTop: 'none',
                marginTop: 0, 
                maxHeight: isMaximized ? 'calc(100vh - 200px)' : '400px', 
                overflowY: 'auto' 
            }}>
              {/* Summary Tab Content */}
              {activeTab === 'summary' && (
                  <div className="tab-content summary-content">
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
              )}

              {/* Details Tab Content */}
              {activeTab === 'details' && isEditMode && (
                  <div className="tab-content details-content">
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
              )}

              {/* Data Tab Content */}
              {activeTab === 'data' && (
                  <div className="tab-content status-content">
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
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

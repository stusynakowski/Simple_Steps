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
    if (isActive) {
      if (onMinimize) onMinimize();
    } else {
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
      data-testid={`operation-column-${step.id}`}
    >
      <div className="op-header" onClick={handleColumnClick} style={{ cursor: 'pointer' }}>
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

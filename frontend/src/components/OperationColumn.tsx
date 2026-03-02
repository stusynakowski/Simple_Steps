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
  const [activeTab, setActiveTab] = useState<'summary' | 'details' | 'data' | 'settings'>('data');
  const [isEditMode] = useState(true);
  const [isLocked, setIsLocked] = useState(false);

  const currentOp = availableOperations.find(op => op.id === step.process_type);
  const hasParams = currentOp && currentOp.params && currentOp.params.length > 0;

  // -- Synchronization Logic --

  // 1. Build Formula from Config
  const buildFormula = (opId: string, config: Record<string, any>) => {
    if (!opId || opId === 'noop') return '';
    const args = Object.entries(config)
      .map(([k, v]) => {
        // Simple quoting for strings, raw for numbers/bools
        const valStr = typeof v === 'string' && !v.startsWith('=') ? `"${v}"` : String(v);
        return `${k}=${valStr}`;
      })
      .join(', ');
    return `=${opId}(${args})`;
  };

  // 2. Parse Formula to Config
  const parseFormula = (formula: string) => {
    if (!formula.startsWith('=')) return null;
    
    const match = formula.match(/^=([a-zA-Z0-9_]+)\((.*)\)$/);
    if (!match) return null;

    const opId = match[1];
    const argsStr = match[2];
    const config: Record<string, any> = {};

    // Basic CSV parser that respects quotes could be better, but simple split for now
    // TODO: Improve regex to handle commas inside quotes
    argsStr.split(',').forEach(arg => {
      const parts = arg.split('=');
      if (parts.length === 2) {
        const key = parts[0].trim();
        let val = parts[1].trim();
        
        // Remove quotes if string
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        } else if (!isNaN(Number(val))) {
          val = String(Number(val));
        }
        
        config[key] = val;
      }
    });

    return { opId, config };
  };

  // Handler for UI-based updates (Dropdowns/Inputs)
  const handleUiUpdate = (updates: Partial<Step>) => {
    const newOpId = updates.process_type !== undefined ? updates.process_type : step.process_type;
    const newConfig = updates.configuration !== undefined ? updates.configuration : step.configuration;
    const newFormula = buildFormula(newOpId, newConfig);
    onUpdate?.(step.id, { ...updates, operation: newFormula });
  };

  // Handler for Formula-based updates (Toolbar Input)
  const handleFormulaUpdate = (id: string, formula: string) => {
    const parsed = parseFormula(formula);
    if (parsed) {
      // Valid formula, update structure
      onUpdate?.(id, {
        operation: formula,
        process_type: parsed.opId,
        configuration: parsed.config
      });
    } else {
      // Invalid or incomplete formula, just update the string so user can keep typing
      onUpdate?.(id, { operation: formula });
    }
  };

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
              onFormulaChange={handleFormulaUpdate}
              onMaximize={onMaximize}
              isMaximized={isMaximized}
              isLocked={isLocked}
              onLock={() => setIsLocked(!isLocked)}
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
              {/* Summary Tab Content - Read-Only Overview */}
              {activeTab === 'summary' && (
                  <div className="tab-content summary-content">
                    <div className="expander-inner" onClick={(e) => e.stopPropagation()}>
                       <div className="summary-item">
                          <span className="label">Step:</span>
                          <span className="value">{step.label}</span>
                       </div>
                       <div className="summary-item">
                          <span className="label">Operation:</span>
                          <span className="value">{opDisplayName}</span>
                       </div>
                       <div className="summary-item">
                          <span className="label">Status:</span>
                          <span className={`status-badge status-${step.status}`}>{step.status}</span>
                       </div>
                       <div style={{ marginTop: 8, fontSize: '0.8rem', color: '#666' }}>
                          {hasParams ? 'Configured with parameters.' : 'No parameters configured.'}
                       </div>
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

              {/* Details (Function) Tab Content - Edit Functionality */}
              {activeTab === 'details' && isEditMode && (
                  <div className="tab-content details-content">
                    <div className="expander-inner" onClick={(e) => e.stopPropagation()}>
                      {/* Operation Selector */}
                      <div className="config-item">
                        <label>Operation:</label>
                        <select 
                            value={step.process_type} 
                            onChange={(e) => {
                                const newOpId = e.target.value;
                                handleUiUpdate({ 
                                    process_type: newOpId,
                                    configuration: {} 
                                });
                            }}
                            disabled={!isActive}
                        >
                            <option value="noop">Select Operation...</option>
                            {availableOperations.map(op => (
                                <option key={op.id} value={op.id}>
                                  {op.category ? `[${op.category}] ` : ''}{op.label}
                                </option>
                            ))}
                        </select>
                      </div>

                      {/* Orchestration Strategy Override */}
                      {currentOp && (
                        <div className="config-item" style={{ borderTop: '1px solid #eee', paddingTop: '8px', marginTop: '8px' }}>
                          <label title="How this function is applied to the data">
                            Orchestration ({currentOp.type || 'dataframe'}):
                          </label>
                          <select
                            value={String(step.configuration._orchestrator || '')}
                            onChange={(e) => {
                              const val = e.target.value;
                              const newConfig = { ...step.configuration };
                              if (val) newConfig._orchestrator = val;
                              else delete newConfig._orchestrator;
                              
                              handleUiUpdate({ configuration: newConfig });
                            }}
                            style={{ fontSize: '0.85em', color: '#555' }}
                          >
                             <option value="">Default ({currentOp.type || 'dataframe'})</option>
                             <option value="map">Row Map (Apply to each row)</option>
                             <option value="filter">Filter (Keep rows where True)</option>
                             <option value="expand">Expand (Explode list results)</option>
                             <option value="source">Source (Generate DataFrame)</option>
                             <option value="dataframe">DataFrame (Raw Transformation)</option>
                          </select>
                        </div>
                      )}
                      
                      {/* Parameters */}
                      {hasParams && (
                        <div style={{ marginTop: '12px' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Parameters</span>
                          {currentOp?.params.map(param => (
                            <div key={param.name} className="config-item">
                              <label>{param.name}:</label>
                              <input 
                                  type="text"
                                  value={String(step.configuration[param.name] ?? (param.default || ''))}
                                  onChange={(e) => {
                                      const val = e.target.value;
                                      const isFormula = val.startsWith('=');
                                      const updateVal = (param.type === 'number' && !isFormula) ? Number(val) : val;
                                      
                                      handleUiUpdate({
                                          configuration: { ...step.configuration, [param.name]: updateVal }
                                      });
                                  }}
                                  onBlur={() => onPreview?.(step.id)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') onPreview?.(step.id); }}
                                  title={param.description}
                                  placeholder={String(param.default || '')}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
              )}

              {/* Settings Tab Content - Miscellaneous Editing */}
              {activeTab === 'settings' && isEditMode && (
                  <div className="tab-content settings-content">
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
                          <span className="label">Step ID:</span>
                          <span className="value" style={{ fontFamily: 'monospace', fontSize: '0.75em' }}>{step.id}</span>
                       </div>
                       <div className="summary-item">
                          <span className="label">Status:</span>
                          <span className={`status-badge status-${step.status}`}>{step.status}</span>
                       </div>
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

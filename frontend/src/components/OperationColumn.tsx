import { useEffect, useRef, useState } from 'react';
import type { Step } from '../types/models';
import type { OperationDefinition } from '../services/api';
import DataOutputGrid from './DataOutputGrid';
import StepToolbar from './StepToolbar';
import PreviousStepDataPicker from './PreviousStepDataPicker';
import { buildFormula } from '../utils/formulaParser';
import type { ParsedFormula } from '../utils/formulaParser';
import { useStepWiring } from '../context/StepWiringContext';
import './OperationColumn.css';

interface OperationColumnProps {
  step: Step;
  /** Zero-based position in the pipeline, used for wiring eligibility */
  stepIndex?: number;
  /** All steps before this one — used for the Previous Step Data picker */
  previousSteps?: Step[];
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
  /** Called with the pointer position when the user drags the header far enough to detach */
  onDetach?: (position: { x: number; y: number }) => void;
}

export default function OperationColumn({
  step,
  stepIndex = 0,
  previousSteps = [],
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
  onDetach,
}: OperationColumnProps) {
  // Tab State
  const [activeTab, setActiveTab] = useState<'summary' | 'details' | 'data' | 'settings'>('data');
  const [isEditMode] = useState(true);
  const [isLocked, setIsLocked] = useState(false);

  // Wiring context — this column is a wiring SOURCE when a later step's formula is focused
  const { wiringState, injectReference, activateWiring, deactivateWiring } = useStepWiring();
  const isWiringSource =
    wiringState.receivingStepId !== null &&
    wiringState.receivingStepId !== step.id &&
    wiringState.receivingStepIndex !== null &&
    stepIndex < wiringState.receivingStepIndex;

  // When this column becomes a wiring source, automatically switch to the data
  // tab so the user can see the output grid without extra clicks.
  const prevWiringSource = useRef(false);
  useEffect(() => {
    if (isWiringSource && !prevWiringSource.current) {
      setActiveTab('data');
    }
    prevWiringSource.current = isWiringSource;
  }, [isWiringSource]);

  // Refs for parameter inputs so they can also participate in wiring
  const paramInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Ref to the formula bar input — forwarded from StepToolbar so the
  // PreviousStepDataPicker can focus + activate wiring without losing context.
  const formulaBarRef = useRef<HTMLInputElement | null>(null);

  /** Called by PreviousStepDataPicker when a column/cell badge is clicked.
   *  Directly injects the reference token into the formula bar without relying
   *  on async wiring state — uses the formulaBarRef we already hold. */
  const handlePickerTokenSelect = (token: string) => {
    const el = formulaBarRef.current;
    if (!el) return;

    // Activate wiring so context state is consistent for other interactions
    activateWiring(step.id, stepIndex, { current: el } as React.RefObject<HTMLInputElement>);

    // Splice the token at the current cursor position (or append)
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    const newValue = before + token + after;

    // Use native setter so React's synthetic onChange fires
    const nativeInputSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;
    nativeInputSetter?.call(el, newValue);
    el.dispatchEvent(new Event('input', { bubbles: true }));

    // If no operation is defined yet and the new value is a bare reference,
    // immediately register it as a passthrough so the step can be run right away.
    if (!newValue.startsWith('=') && (step.process_type === 'noop' || step.process_type === 'passthrough' || !step.process_type)) {
      const internalKeys = Object.fromEntries(
        Object.entries(step.configuration).filter(([k]) => k.startsWith('_') && k !== '_ref')
      );
      onUpdate?.(step.id, {
        operation: newValue,
        process_type: 'passthrough',
        configuration: { ...internalKeys, _ref: newValue },
      });
    }

    // Focus and move cursor to after the token
    const newCursor = start + token.length;
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(newCursor, newCursor);
    }, 0);
  };

  // Formula derived from step — kept in sync so StepToolbar reflects config changes
  const derivedFormula = buildFormula(step.process_type, step.configuration);

  const currentOp = availableOperations.find(op => op.id === step.process_type);
  const hasParams = currentOp && currentOp.params && currentOp.params.length > 0;

  // Handler for UI-based updates (Dropdowns/Inputs)
  const handleUiUpdate = (updates: Partial<Step>) => {
    const newOpId = updates.process_type !== undefined ? updates.process_type : step.process_type;
    const newConfig = updates.configuration !== undefined ? updates.configuration : step.configuration;
    const newFormula = buildFormula(newOpId, newConfig);
    onUpdate?.(step.id, { ...updates, operation: newFormula });
  };

  // Handler for Formula-based updates (Toolbar Input)
  const handleFormulaUpdate = (_id: string, formula: string, parsed: ParsedFormula) => {
    if (parsed.isValid && parsed.operationId) {
      // Preserve internal keys (e.g. _orchestrator) that aren't in the formula
      const internalKeys = Object.fromEntries(
        Object.entries(step.configuration).filter(([k]) => k.startsWith('_'))
      );
      onUpdate?.(step.id, {
        operation: formula,
        process_type: parsed.operationId,
        configuration: { ...internalKeys, ...parsed.args },
      });
    } else if (parsed.operationId && !parsed.isValid) {
      // Partial formula (user is still typing) — update process_type so the
      // details panel switches to the right operation, but don't overwrite config
      onUpdate?.(step.id, {
        operation: formula,
        process_type: parsed.operationId,
      });
    } else if (formula && !formula.startsWith('=')) {
      // Bare reference token (e.g. "step-abc.url") with no operation specified.
      // Treat as a pass-through / identity: resolve the reference on run and
      // display that data as this step's output.
      // This branch fires for ANY non-formula text so the user can freely edit
      // the token — _ref always stays in sync with what's in the bar.
      const internalKeys = Object.fromEntries(
        Object.entries(step.configuration).filter(([k]) => k.startsWith('_') && k !== '_ref')
      );
      onUpdate?.(step.id, {
        operation: formula,
        process_type: 'passthrough',
        configuration: { ...internalKeys, _ref: formula },
      });
    } else {
      // Incomplete / plain text — just keep the raw string
      onUpdate?.(step.id, { operation: formula });
    }
  };

  // Calculate display name for the operation summary
  const getOperationDisplayName = () => {
    if (!step.process_type || step.process_type === 'noop') return 'None';
    if (step.process_type === 'passthrough') {
      const ref = String(step.configuration._ref || step.operation || '');
      return ref ? `↳ ${ref}` : 'Pass-through';
    }
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

  // ── Drag-to-detach on header ──────────────────────────────────────────────
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dragTriggered = useRef(false);
  const [isDragHinting, setIsDragHinting] = useState(false);
  const DETACH_THRESHOLD = 18; // px of movement before detach fires

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    // Only on left-button drags, and only if onDetach is wired up
    if (e.button !== 0 || !onDetach) return;
    // Ignore clicks on any interactive child (buttons, etc.)
    if ((e.target as HTMLElement).closest('button, select, input, a')) return;
    dragStart.current = { x: e.clientX, y: e.clientY };
    dragTriggered.current = false;

    const onMove = (me: MouseEvent) => {
      if (!dragStart.current) return;
      const dx = me.clientX - dragStart.current.x;
      const dy = me.clientY - dragStart.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 4) setIsDragHinting(true);
      if (!dragTriggered.current && dist > DETACH_THRESHOLD) {
        dragTriggered.current = true;
        dragStart.current = null;
        setIsDragHinting(false);
        cleanup();
        onDetach({ x: me.clientX - 20, y: me.clientY - 18 });
      }
    };

    const onUp = () => {
      dragStart.current = null;
      setIsDragHinting(false);
      cleanup();
    };

    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      className={`operation-column ${isActive ? 'active' : ''} ${isMaximized ? 'maximized' : ''} ${isSqueezed ? 'squeezed' : ''} ${isWiringSource ? 'wiring-source-column' : ''} status-${step.status}`}
      style={{ 
        '--step-color': color,
        zIndex: zIndex,
        ...(isWiringSource ? { outline: '2px solid #ffc107', outlineOffset: -2 } : {}),
      } as React.CSSProperties}
      data-testid={`operation-column-${step.id}`}
    >
      <div className={`op-header${isDragHinting ? ' drag-detach-hint' : ''}`} onClick={handleColumnClick} onMouseDown={handleHeaderMouseDown} style={{ cursor: 'pointer', position: 'relative' }}>
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
        {/* Wiring source badge */}
        {isWiringSource && (
          <span
            style={{
              position: 'absolute',
              top: 4,
              right: isSqueezed ? 4 : 8,
              background: '#ffc107',
              color: '#5d4037',
              borderRadius: 3,
              padding: '1px 5px',
              fontSize: '0.62rem',
              fontWeight: 700,
              letterSpacing: '0.04em',
              zIndex: 10,
              pointerEvents: 'none',
            }}
          >
            ⚡ source
          </span>
        )}
      </div>


      <div className={`op-body ${isSqueezed ? 'squeezed' : ''}`}>
        <div className="op-body-inner">
          {!isSqueezed && (
            <StepToolbar 
              step={step}
              stepIndex={stepIndex}
              availableOperations={availableOperations}
              onRun={() => onRun(step.id)}
              onDelete={() => onDelete(step.id)}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              onFormulaChange={handleFormulaUpdate}
              externalFormula={derivedFormula}
              onMaximize={onMaximize}
              isMaximized={isMaximized}
              isLocked={isLocked}
              onLock={() => setIsLocked(!isLocked)}
              onFormulaBarRef={(el) => { formulaBarRef.current = el; }}
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
                       <div className="summary-item">
                          <span className="label">Execution ID:</span>
                          <span className="value" style={{ fontFamily: 'monospace', fontSize: '0.75em', color: '#888' }}>{step.id.substring(0, 8)}</span>
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
                    <div className="expander-inner data-grid-expander" onClick={(e) => e.stopPropagation()}>
                      <DataOutputGrid 
                        cells={step.output_preview} 
                        onCellClick={(cell) => console.log('Cell clicked:', cell)}
                        wiringMode={isWiringSource}
                        sourceStepId={step.id}
                        onWireColumn={(token) => injectReference(token)}
                        onWireCell={(token) => injectReference(token)}
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
                            <option value="passthrough" disabled style={{ color: '#aaa' }}>
                              ↳ Pass-through (reference selected)
                            </option>
                            {availableOperations.map(op => (
                                <option key={op.id} value={op.id}>
                                  {op.category ? `[${op.category}] ` : ''}{op.label}
                                </option>
                            ))}
                        </select>
                      </div>

                      {/* Previous Step Data Picker — always visible in details tab when
                          prior steps exist. Lets the user click a column/cell reference
                          before or during operation configuration. */}
                      {previousSteps.length > 0 && (
                        <PreviousStepDataPicker
                          previousSteps={previousSteps}
                          onTokenSelect={handlePickerTokenSelect}
                        />
                      )}

                      {/* Orchestration Strategy Override */}
                      {currentOp && (
                        <div className="config-item" style={{ borderTop: '1px solid #eee', paddingTop: '10px', marginTop: '10px' }}>
                          <label>Orchestration:</label>
                          <select
                            value={String(step.configuration._orchestrator || '')}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              e.stopPropagation();
                              const newConfig = { ...step.configuration };
                              if (e.target.value) newConfig._orchestrator = e.target.value;
                              else delete newConfig._orchestrator;
                              handleUiUpdate({ configuration: newConfig });
                            }}
                          >
                            <option value="">⚙️ Default — Use the operation's built-in mode ({currentOp.type || 'dataframe'})</option>
                            <option value="source">🌱 Source — Generate a brand-new DataFrame from scratch (no input needed)</option>
                            <option value="dataframe">🗂️ DataFrame — Pass the entire DataFrame directly into the function</option>
                            <option value="map">🔁 Row Map — Run the function once per row, adding results as new columns</option>
                            <option value="filter">🔍 Filter — Keep only rows where the function returns True</option>
                            <option value="expand">↕️ Expand — Explode list results so each item becomes its own row</option>
                            <option value="raw_output">🔬 Raw Output — Call the function directly with no orchestration</option>
                          </select>
                        </div>
                      )}
                      
                      {/* Parameters */}
                      {hasParams && (
                        <div style={{ marginTop: '12px' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Parameters</span>
                          {currentOp?.params.map(param => {
                            const paramVal = String(step.configuration[param.name] ?? (param.default || ''));
                            const isWiredValue = paramVal.includes('.');
                            return (
                            <div key={param.name} className="config-item">
                              <label title={param.description}>{param.name}:</label>
                              <div style={{ position: 'relative', flex: 1 }}>
                                <input 
                                    ref={(el) => { paramInputRefs.current[param.name] = el; }}
                                    type="text"
                                    value={paramVal}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        const isFormula = val.startsWith('=');
                                        const updateVal = (param.type === 'number' && !isFormula) ? Number(val) : val;
                                        handleUiUpdate({
                                            configuration: { ...step.configuration, [param.name]: updateVal }
                                        });
                                    }}
                                    onFocus={() => {
                                      const el = paramInputRefs.current[param.name];
                                      if (el) {
                                        activateWiring(
                                          step.id,
                                          stepIndex,
                                          { current: el } as React.RefObject<HTMLInputElement>
                                        );
                                      }
                                    }}
                                    onBlur={() => {
                                      deactivateWiring();
                                      onPreview?.(step.id);
                                    }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') onPreview?.(step.id); }}
                                    title={param.description}
                                    placeholder={String(param.default || '')}
                                    style={{
                                      width: '100%',
                                      boxSizing: 'border-box',
                                      ...(isWiredValue ? {
                                        background: '#fffde7',
                                        borderColor: '#ffc107',
                                        color: '#856404',
                                      } : {}),
                                    }}
                                />
                                {isWiredValue && (
                                  <span
                                    title="This parameter references another step's output"
                                    style={{
                                      position: 'absolute',
                                      right: 4,
                                      top: '50%',
                                      transform: 'translateY(-50%)',
                                      fontSize: '0.65rem',
                                      color: '#ffa000',
                                      pointerEvents: 'none',
                                    }}
                                  >
                                    ⚡
                                  </span>
                                )}
                              </div>
                            </div>
                            );
                          })}
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

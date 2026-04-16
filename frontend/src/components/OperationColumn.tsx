import { useEffect, useRef, useState, useMemo } from 'react';
import type { Step } from '../types/models';
import type { OperationDefinition } from '../services/api';
import DataOutputGrid from './DataOutputGrid';
import StepToolbar from './StepToolbar';
import PreviousStepDataPicker from './PreviousStepDataPicker';
import { buildFormula, parseFormula } from '../utils/formulaParser';
import type { ParsedFormula, OrchestrationMode } from '../utils/formulaParser';
import { useStepWiring } from '../context/StepWiringContext';
import { useStagedPreview } from '../hooks/useStagedPreview';
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

  // Track whether the user is hovering over this column while it's a wiring source.
  // The yellow highlight and wiring UI only appear on hover, not automatically.
  const [isWiringHovered, setIsWiringHovered] = useState(false);

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

    // Context-aware: if inside parens, prefix with "data=" when no param name present
    let insertText = token;
    const insideParens = before.includes('(') && (after.includes(')') || !after.trim());
    if (insideParens) {
      const afterLastCommaOrParen = before.slice(Math.max(before.lastIndexOf('('), before.lastIndexOf(',')) + 1).trim();
      if (!afterLastCommaOrParen.includes('=')) {
        insertText = `data=${token}`;
      }
    }

    const newValue = before + insertText + after;

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
        formula: newValue,
        operation: newValue,
        process_type: 'passthrough',
        configuration: { ...internalKeys, _ref: newValue },
      });
    }

    // Focus and move cursor to after the token
    const newCursor = start + insertText.length;
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(newCursor, newCursor);
    }, 0);
  };

  // The formula bar always reflects step.formula (the canonical field).
  // buildFormula is only used as a fallback for legacy steps that predate
  // the formula field (i.e. loaded from old save files without a formula).
  // With the backend model_validator fix, step.formula should always be set,
  // but we keep this client-side fallback for resilience.
  const currentOp = availableOperations.find(op => op.id === step.process_type);
  const hasParams = currentOp && currentOp.params && currentOp.params.length > 0;

  const derivedFormula = step.formula || buildFormula(
    step.process_type,
    step.configuration as Record<string, any>,
    (step.configuration._orchestrator as OrchestrationMode | undefined)
      ?? (currentOp?.type as OrchestrationMode | undefined)
      ?? null,
  );

  // ── Staged preview state ───────────────────────────────────────────────────
  // Track what the user is typing live — separate from committed step.formula
  // Prefer step.formula first, then derivedFormula, then legacy operation field.
  const [liveFormula, setLiveFormula] = useState<string>(step.formula || derivedFormula || step.operation || '');

  // Keep liveFormula in sync when the step is updated externally
  useEffect(() => {
    setLiveFormula(step.formula || derivedFormula || step.operation || '');
  }, [step.formula, step.operation, derivedFormula]);

  // Parse the live formula so the staged preview hook gets a typed ParsedFormula
  const liveParsed = useMemo(
    () => (liveFormula ? parseFormula(liveFormula) : null),
    [liveFormula]
  );

  // Derive upstream rows/columns from the last previous step's output_preview
  const upstreamRows = useMemo<Record<string, unknown>[]>(() => {
    const lastStep = previousSteps[previousSteps.length - 1];
    if (!lastStep?.output_preview || lastStep.output_preview.length === 0) return [];
    const colIds = Array.from(new Set(lastStep.output_preview.map((c) => c.column_id)));
    const rowIds = Array.from(new Set(lastStep.output_preview.map((c) => c.row_id))).sort(
      (a, b) => a - b
    );
    return rowIds.map((rowId) =>
      Object.fromEntries(
        colIds.map((colId) => {
          const cell = lastStep.output_preview!.find(
            (c) => c.row_id === rowId && c.column_id === colId
          );
          return [colId, cell?.value ?? null];
        })
      )
    );
  }, [previousSteps]);

  const upstreamColumns = useMemo(() => {
    const lastStep = previousSteps[previousSteps.length - 1];
    if (!lastStep?.output_preview) return [];
    return Array.from(new Set(lastStep.output_preview.map((c) => c.column_id)));
  }, [previousSteps]);

  const stagedPreview = useStagedPreview({
    step,
    parsed: liveParsed,
    availableOperations,
    upstreamRows,
    upstreamColumns,
    previewRowCount: 6,
  });

  // Show staged preview when the formula has been touched but step hasn't been
  // (re-)run — or when the live formula differs from what was last executed
  const hasUncommittedFormula =
    liveFormula !== '' &&
    (step.status === 'pending' ||
      step.status === 'stopped' ||
      liveFormula !== (step.formula ?? step.operation ?? ''));

  // Handler for UI-based updates (Dropdowns/Inputs in the Details tab)
  // The UI form writes to the formula FIRST; process_type and configuration
  // are derived from the formula and kept in sync.
  const handleUiUpdate = (updates: Partial<Step>) => {
    const newOpId = updates.process_type !== undefined ? updates.process_type : step.process_type;
    const newConfig = updates.configuration !== undefined ? updates.configuration : step.configuration;
    // Preserve the orchestration modifier already in the formula if no config override
    const existingParsed = step.formula ? parseFormula(step.formula) : null;
    const orchMode = (newConfig._orchestrator as import('../utils/formulaParser').OrchestrationMode | undefined)
      ?? existingParsed?.orchestration
      ?? currentOp?.type as import('../utils/formulaParser').OrchestrationMode | undefined
      ?? null;
    const newFormula = buildFormula(newOpId, newConfig, orchMode);
    setLiveFormula(newFormula); // keep staged preview in sync
    onUpdate?.(step.id, { ...updates, formula: newFormula, operation: newFormula });
  };

  // Handler for Formula-based updates (Toolbar Input)
  // The formula bar is the canonical write path. Everything else is derived from it.
  const handleFormulaUpdate = (_id: string, formula: string, parsed: ParsedFormula) => {
    setLiveFormula(formula); // immediately drive staged preview
    if (parsed.isValid && parsed.operationId) {
      // Preserve internal keys (e.g. _orchestrator) that aren't in the formula.
      // The orchestration modifier in the formula takes precedence; store it as
      // _orchestrator in config so the engine and orchestration dropdown stay in sync.
      const internalKeys = Object.fromEntries(
        Object.entries(step.configuration).filter(([k]) => k.startsWith('_'))
      );
      const orchConfig = parsed.orchestration
        ? { ...internalKeys, _orchestrator: parsed.orchestration, ...parsed.args }
        : { ...internalKeys, ...parsed.args };
      onUpdate?.(step.id, {
        formula,
        operation: formula,   // keep legacy field in sync during migration
        process_type: parsed.operationId,
        configuration: orchConfig,
      });
    } else if (parsed.operationId && !parsed.isValid) {
      // Partial formula (user is still typing) — update process_type so the
      // details panel switches to the right operation, but don't overwrite config
      onUpdate?.(step.id, {
        formula,
        operation: formula,
        process_type: parsed.operationId,
      });
    } else if (formula && !formula.startsWith('=')) {
      // Bare reference token (e.g. "step-abc.url") — pass-through mode.
      const internalKeys = Object.fromEntries(
        Object.entries(step.configuration).filter(([k]) => k.startsWith('_') && k !== '_ref')
      );
      onUpdate?.(step.id, {
        formula,
        operation: formula,
        process_type: 'passthrough',
        configuration: { ...internalKeys, _ref: formula },
      });
    } else {
      // Incomplete / plain text — just keep the raw string
      onUpdate?.(step.id, { formula, operation: formula });
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
      className={`operation-column ${isActive ? 'active' : ''} ${isMaximized ? 'maximized' : ''} ${isSqueezed ? 'squeezed' : ''} status-${step.status}`}
      style={{ 
        '--step-color': color,
        zIndex: zIndex,
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
      </div>


      <div className={`op-body ${isSqueezed ? 'squeezed' : ''}`}>
        <div className="op-body-inner">
          {!isSqueezed && (
            <StepToolbar
              key={step.id}
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
                            activeTab === 'data' ? '#1e1e1e' : '#fff',
                border: 'none', 
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
                  <div
                    className="tab-content status-content"
                    onMouseEnter={() => { if (isWiringSource) setIsWiringHovered(true); }}
                    onMouseLeave={() => setIsWiringHovered(false)}
                    style={isWiringSource && isWiringHovered ? { outline: '2px solid #ffc107', outlineOffset: -2, borderRadius: 4 } : {}}
                  >
                    <div className="expander-inner data-grid-expander" onClick={(e) => e.stopPropagation()}>
                      <DataOutputGrid
                        cells={step.output_preview}
                        onCellClick={(cell) => console.log('Cell clicked:', cell)}
                        wiringMode={isWiringSource && isWiringHovered}
                        sourceStepId={step.id}
                        onWireColumn={(token) => injectReference(token)}
                        onWireCell={(token) => injectReference(token)}
                        stagedColumns={hasUncommittedFormula ? stagedPreview.columns : []}
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

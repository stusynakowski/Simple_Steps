import { useEffect, useRef, useState } from 'react';
import type { Step } from '../types/models';
import type { OperationDefinition, ResourceDeclaration } from '../services/api';
import type { ProgressEvent } from '../services/api';
import DataOutputGrid from './DataOutputGrid';
import StepToolbar from './StepToolbar';
import { placePick, stepRef } from '../utils/selection';
import type { GridPick, PlacedPick } from '../utils/selection';
import { parseFormula } from '../utils/formulaParser';
import type { FormulaReference, ParsedFormula } from '../utils/formulaParser';
import { getStepColor } from '../styles/theme';
import ToolEditor from './ToolEditor';
import StepWidget from './StepWidget';
import type { PanelId } from './stepPanels';
import StepOverview from './StepOverview';
import { useStepWiring } from '../context/StepWiringContext';
import { useSetGridHover } from '../context/StepsStatusContext';
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
  isMaximized?: boolean;
  /** Shrunk to a tight header by the header's minimize button. */
  isMinimized?: boolean;
  zIndex?: number;
  onActivate: (id: string) => void;
  onUpdate?: (id: string, updates: Partial<Step>) => void;
  onRun: (id: string) => void;
  /** Declare the workflow, running nothing (Enter in the formula bar). */
  onDeclare?: () => void;
  onPreview?: (id: string) => void;
  onPause: (id: string) => void;
  onDelete: (id: string) => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  /** The header's minimize button: hide the step UI, shrink the header. */
  onMinimizeStep?: () => void;
  /** Every step's name, so a new select step gets a unique one. */
  /** Insert a step (name, formula) just before this one; returns its id. */
  /** Replace another step's formula (a select step this one made). */
  /** Called with the pointer position when the user drags the header far enough to detach */
  onDetach?: (position: { x: number; y: number }) => void;
  /** Live progress for row-iterating operations */
  progress?: ProgressEvent;
  pipelineStatus?: 'idle' | 'running' | 'paused';
  pipelineCursorIndex?: number;
  /** The workflow's resources, for resource arguments in the step editor. */
  resources?: Record<string, unknown>;
  /** Change a resource's settings (the Resources menu's define). */
  onDefineResource?: (name: string, definition: string) => Promise<void>;
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
  isMinimized = false,
  zIndex = 1,
  onActivate,
  onUpdate,
  onRun,
  onDeclare,
  onPreview,
  onDelete,
  onMinimize,
  onMaximize,
  onMinimizeStep,
  resources,
  onDefineResource,
  onDetach,
  progress,
  pipelineStatus = 'idle',
  pipelineCursorIndex = -1,
}: OperationColumnProps) {
  const widgetMaxHeight = isMaximized ? 'calc(100vh - 200px)' : '400px';
  // Widgets: any number open at once (toolbar buttons toggle them); each
  // open one can be collapsed to its name bar.
  const [openPanels, setOpenPanels] = useState<PanelId[]>(['data']);
  const [collapsedPanels, setCollapsedPanels] = useState<Set<PanelId>>(new Set());
  // The data's size and selection, from the grid, shown on the Data bar.
  const [dataNote, setDataNote] = useState('');
  const isOpen = (panel: PanelId) => openPanels.includes(panel);
  const togglePanel = (panel: PanelId) =>
    setOpenPanels((open) => open.includes(panel) ? open.filter((p) => p !== panel) : [...open, panel]);
  const toggleCollapsed = (panel: PanelId) =>
    setCollapsedPanels((collapsed) => {
      const next = new Set(collapsed);
      if (next.has(panel)) next.delete(panel); else next.add(panel);
      return next;
    });
  const [isEditMode] = useState(true);
  const [isLocked, setIsLocked] = useState(false);

  // Wiring context — this column is a wiring SOURCE when a later step's formula is focused
  const { wiringState, pickFrom, setActiveSelection, setReferences } = useStepWiring();
  // What the pointer is over in this step's grid, for the steps bar's status.
  const setGridHover = useSetGridHover();
  const isWiringSource =
    wiringState.receivingStepId !== null &&
    wiringState.receivingStepId !== step.id &&
    wiringState.receivingStepIndex !== null &&
    stepIndex < wiringState.receivingStepIndex;

  // Track whether the user is hovering over this column while it's a wiring source.
  // The yellow highlight and wiring UI only appear on hover, not automatically.
  const [isWiringHovered, setIsWiringHovered] = useState(false);

  // Refs for parameter inputs so they can also participate in wiring

  // Ref to the formula bar input — forwarded from StepToolbar so a pick from
  // another step's grid lands at the formula bar's cursor.
  const formulaBarRef = useRef<HTMLTextAreaElement | null>(null);

  // ── Picking data from an earlier step ────────────────────────────────────
  // A pick (a cell, a block, rows, columns, the whole table) arrives in core's
  // notation (utils/selection.ts) and is written where the caret is (D1). The
  // formula bar is written through its hidden textarea plus an `input` event,
  // the same path typing takes, so the formula is parsed and committed exactly
  // as if it had been typed.

  /** Where the last pick was written, so the next one replaces it (as in Excel). */
  const lastPick = useRef<PlacedPick | null>(null);

  const writeFormulaBar = (value: string, cursor = value.length) => {
    const el = formulaBarRef.current;
    if (!el) return;
    // Where the caret goes after the write — FormulaEditor reads it when it
    // copies the new value into Monaco.
    el.dataset.selStart = String(cursor);
    el.dataset.selEnd = String(cursor);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const handleReferencePick = (sourceStep: string, pick: GridPick) => {
    const el = formulaBarRef.current;
    if (!pick.text || !el) return;
    setActiveSelection(pick.text);
    // The caret is the one Monaco last had (FormulaEditor keeps it on the
    // element), since a grid click has already blurred the formula bar.
    const start = Number(el.dataset.selStart ?? el.selectionStart ?? el.value.length);
    const caret = { start, end: Number(el.dataset.selEnd ?? start) };
    const { value, cursor, placed } = placePick(el.value, caret, lastPick.current, pick.text,
      pick.text === stepRef(sourceStep));
    writeFormulaBar(value, cursor);
    lastPick.current = placed;
  };

  // The formula bar always reflects step.formula (the canonical field);
  // useWorkflow fills it in for legacy steps saved without one.
  const savedFormula = step.formula || step.operation || '';

  // ── References in the formula (R3) ──────────────────────────────────────
  // Where each wf["…"] is in the formula and what it covers, from the parser
  // (F8): drawn dashed in the formula bar in its step's colour, and, while this
  // formula bar has focus, boxed in the source step's grid.
  const [refsOf, setRefsOf] = useState<{ formula: string; refs: FormulaReference[] }>({ formula: '', refs: [] });
  useEffect(() => {
    if (refsOf.formula === savedFormula) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      parseFormula(savedFormula)
        .then((p) => { if (!cancelled) setRefsOf({ formula: savedFormula, refs: p.references ?? [] }); })
        .catch(() => {});
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [savedFormula, refsOf.formula]);
  const colorOf = Object.fromEntries(previousSteps.map((s, i) => [s.label, s.step_color ?? getStepColor(i)]));
  const barReferences = refsOf.refs.map((r) => ({ start: r.span[0], end: r.span[1], color: colorOf[r.step] ?? '#888' }));

  // A new round of picking starts fresh: the last pick is only replaced while
  // this formula bar is still receiving.
  const isReceiving = wiringState.receivingStepId === step.id;
  useEffect(() => {
    if (!isReceiving) lastPick.current = null;
  }, [isReceiving]);
  useEffect(() => {
    if (isReceiving) setReferences(refsOf.refs);
  }, [isReceiving, refsOf.refs, setReferences]);

  const isScheduledInPipeline =
    pipelineStatus === 'running' &&
    step.status === 'pending' &&
    pipelineCursorIndex >= 0 &&
    stepIndex >= pipelineCursorIndex;

  // The status pill shows a spinner while the step runs, and a dimmer one
  // while it waits its turn in a running pipeline.
  const isRunning = step.status === 'running';
  const isQueued = !isRunning && isScheduledInPipeline;
  // Out of date: something it reads changed since it ran (core's staleness,
  // dev_plan/124 phase 2). Its output stays; the reason is the tooltip.
  const outOfDate = !isRunning && !isQueued && step.status === 'completed' && !!step.staleReason;
  const statusLabel = isQueued ? 'queued' : outOfDate ? 'out of date' : step.status;
  const statusTitle = outOfDate ? `Out of date: ${step.staleReason}. Run it again to update.` : undefined;
  const statusSpinner = (isRunning || isQueued) && (
    <span className={`status-spinner${isQueued ? ' queued' : ''}`} aria-hidden="true" />
  );

  // A maximized step scrolls into view, so the wider step is what you see.
  const columnRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (isMaximized) {
      columnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    }
  }, [isMaximized]);

  const stagedCellMode: 'idle' | 'scheduled' | 'running' =
    step.status === 'running'
      ? 'running'
      : isScheduledInPipeline
        ? 'scheduled'
        : 'idle';

  // Core's reason a staged step's rows aren't exactly known yet (its plan, R6):
  // unknown ("its input doesn't know its row count") or bounded ("one row per group").
  const planNote = step.plan?.rows && step.plan.rows.certainty !== 'exact' ? step.plan.rows.because : undefined;

  // Handler for Formula-based updates (Toolbar Input)
  // The formula bar is the canonical write path. Everything else is derived from it.
  const handleFormulaUpdate = (_id: string, formula: string, parsed: ParsedFormula) => {
    setRefsOf({ formula, refs: parsed.references ?? [] });
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
    } else {
      // A valid bare reference parses as `passthrough` and is handled above;
      // anything reaching here is half-typed, whether or not it starts with '='.
      // Incomplete / plain text — just keep the raw string
      onUpdate?.(step.id, { formula, operation: formula });
    }
  };

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
      ref={columnRef}
      className={`operation-column ${isActive ? 'active' : ''} ${isMaximized ? 'maximized' : ''} ${isSqueezed ? 'squeezed' : ''} ${isMinimized ? 'minimized' : ''} status-${step.status}`}
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
                 <span className="vertical-label">{statusSpinner}{step.label}</span>
            ) : (
                <>
                    <div className="header-titles">
                        <h3 className="op-name">{step.label}</h3>
                        <span className={`op-status-indicator${outOfDate ? ' is-out-of-date' : ''}`} title={statusTitle}>{statusSpinner}{statusLabel}</span>
                    </div>
                </>
            )}
        </div>
        {/* Hover controls — top right of the header. They stop mousedown so a
            click never starts the header's drag-to-detach. */}
        <div className="step-header-controls" onMouseDown={(e) => e.stopPropagation()}>
          {!isMinimized && onMinimizeStep && (
            <button
              type="button"
              className="step-header-btn"
              onClick={(e) => { e.stopPropagation(); onMinimizeStep(); }}
              title="Minimize"
              aria-label={`Minimize ${step.label}`}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          )}
          {onMaximize && (
            <button
              type="button"
              className="step-header-btn"
              onClick={(e) => { e.stopPropagation(); onMaximize(); }}
              title={isMaximized ? 'Restore size' : 'Maximize'}
              aria-label={`${isMaximized ? 'Restore' : 'Maximize'} ${step.label}`}
            >
              {isMaximized ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Progress bar — visible during row-iterating operations */}
      {step.status === 'running' && progress && progress.total > 0 && (
        <div className="step-progress-bar-container">
          <div className="step-progress-bar" style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }} />
          <span className="step-progress-label">
            {progress.current} / {progress.total} — {Math.round((progress.current / progress.total) * 100)}%
            {progress.elapsed > 0 && ` (${progress.elapsed}s)`}
          </span>
        </div>
      )}

      <div className={`op-body ${isSqueezed ? 'squeezed' : ''}`}>
        <div className="op-body-inner">
          {!isSqueezed && (
            <StepToolbar
              key={step.id}
              step={step}
              stepIndex={stepIndex}
              availableOperations={availableOperations}
              onRun={() => onRun(step.id)}
              onDeclare={onDeclare}
              onDelete={() => onDelete(step.id)}
              openPanels={openPanels}
              onTogglePanel={togglePanel}
              onFormulaChange={handleFormulaUpdate}
              externalFormula={savedFormula}
              previousStep={previousSteps.length ? previousSteps[previousSteps.length - 1].label : null}
              isLocked={isLocked}
              onLock={() => setIsLocked(!isLocked)}
              onFormulaBarRef={(el) => { formulaBarRef.current = el; }}
              onReferencePick={handleReferencePick}
              references={barReferences}
            />
          )}

          {isActive && openPanels.length > 0 && (
            // `op-content-section` is kept so the detached window's taller cap applies.
            <div className="op-content-section step-widget-stack">
              {/* Analytics */}
              {isOpen('overview') && (
                <StepWidget id="overview" collapsed={collapsedPanels.has('overview')} onToggleCollapse={toggleCollapsed} background="transparent" maxHeight={widgetMaxHeight}>
                  <StepOverview step={step} availableOperations={availableOperations} />
                </StepWidget>
              )}

              {/* Settings Tab Content - Miscellaneous Editing */}
              {isOpen('settings') && isEditMode && (
                <StepWidget id="settings" collapsed={collapsedPanels.has('settings')} onToggleCollapse={toggleCollapsed} background="#fff" maxHeight={widgetMaxHeight}>
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
                       {/* Colour: the swatch is a native colour input, so a
                           click opens the system picker (a colour wheel on
                           macOS). Saved as the step's meta.step_color. */}
                       <div className="config-item">
                          <label htmlFor={`step-color-${step.id}`}>Color</label>
                          <div className="step-color-row">
                            <label className="step-color-button" title="Choose the step's colour">
                              <input
                                id={`step-color-${step.id}`}
                                type="color"
                                className="step-color-input"
                                value={/^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : '#888888'}
                                onChange={(e) => onUpdate?.(step.id, { step_color: e.target.value })}
                              />
                              <span>Change color…</span>
                            </label>
                            {step.step_color && (
                              <button
                                type="button"
                                className="step-color-reset"
                                onClick={() => onUpdate?.(step.id, { step_color: undefined })}
                                title="Back to the default colour for this position"
                              >
                                Reset
                              </button>
                            )}
                          </div>
                       </div>
                       {/* Notes: Markdown, shown rendered in Analytics.
                           Saved as the step's meta.notes. */}
                       <div className="config-item config-item--stacked">
                          <label htmlFor={`step-notes-${step.id}`}>
                            Notes <span className="config-hint">Markdown · shown in Analytics</span>
                          </label>
                          <textarea
                            id={`step-notes-${step.id}`}
                            className="step-notes-input"
                            rows={4}
                            value={step.notes ?? ''}
                            onChange={(e) => onUpdate?.(step.id, { notes: e.target.value || undefined })}
                            placeholder="What is this step for? e.g. **Keeps** only rows with a score over 5."
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
                       {/* Core's warnings from the last run (spec 009 REQ-RUN-002). */}
                       {!!step.warnings?.length && (
                         <div className="summary-item step-warnings" data-testid="step-warnings">
                           <span className="label">Warnings:</span>
                           <ul className="value">
                             {step.warnings.map((w) => <li key={w}>{w}</li>)}
                           </ul>
                         </div>
                       )}
                    </div>
                  </div>
              </StepWidget>
              )}

              {/* Details (Function) Tab Content - Edit Functionality */}
              {isOpen('details') && isEditMode && (
                <StepWidget id="details" collapsed={collapsedPanels.has('details')} onToggleCollapse={toggleCollapsed} background="#1e1e1e" maxHeight={widgetMaxHeight}>
                  <div className="tab-content details-content">
                    <div className="expander-inner" onClick={(e) => e.stopPropagation()}>
                      {/* The formula as a form: Tool, then Inputs and Modifiers. */}
                      <ToolEditor
                        formula={savedFormula}
                        availableOperations={availableOperations}
                        previousSteps={previousSteps}
                        resources={resources as Record<string, ResourceDeclaration> | undefined}
                        onDefineResource={onDefineResource}
                        onChange={(formula, parsed) => {
                          handleFormulaUpdate(step.id, formula, parsed);
                          onPreview?.(step.id);
                        }}
                      />
                    </div>
                  </div>
              </StepWidget>
              )}

              {/* Data Tab Content */}
              {isOpen('data') && (
                <StepWidget id="data" collapsed={collapsedPanels.has('data')} onToggleCollapse={toggleCollapsed} background="#1e1e1e" maxHeight={widgetMaxHeight} note={dataNote}>
                  <div
                    className="tab-content status-content"
                    onMouseEnter={() => { if (isWiringSource) setIsWiringHovered(true); }}
                    onMouseLeave={() => setIsWiringHovered(false)}
                    style={isWiringSource && isWiringHovered ? { outline: '2px solid #ffc107', outlineOffset: -2, borderRadius: 4 } : {}}
                  >
                    <div className="expander-inner data-grid-expander" onClick={(e) => e.stopPropagation()}>
                      <DataOutputGrid
                        cells={step.output_preview}
                        refId={step.outputRefId}
                        wiringMode={isWiringSource}
                        onPick={(pick) => pickFrom(step.label, pick)}
                        columns={step.viewColumns}
                        planNote={planNote}
                        stagedCellMode={stagedCellMode}
                        onHoverChange={(spot) => setGridHover(spot && { ...spot, step: step.label })}
                        onNoteChange={setDataNote}
                        stepName={step.label}
                        stepColor={color}
                        formula={step.formula}
                      />
                    </div>
                  </div>
              </StepWidget>
              )}

            </div>
          )}
        </div>
      </div>
    </div>
  );
}

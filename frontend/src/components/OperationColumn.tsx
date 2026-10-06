import { useEffect, useRef, useState, useMemo } from 'react';
import type { Step } from '../types/models';
import type { OperationDefinition } from '../services/api';
import type { ProgressEvent } from '../services/api';
import DataOutputGrid from './DataOutputGrid';
import StepToolbar from './StepToolbar';
import PreviousStepDataPicker from './PreviousStepDataPicker';
import { applyPick, parseSelectionFormula, selectionFormula, selectStepName, stepRef } from '../utils/selection';
import type { GridPick, Selection } from '../utils/selection';
import { buildFormula, parseFormula } from '../utils/formulaParser';
import type { ParsedFormula, OrchestrationMode } from '../utils/formulaParser';
import OrchestrationControl from './OrchestrationControl';
import StepWidget from './StepWidget';
import type { PanelId } from './stepPanels';
import StepOverview from './StepOverview';
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
  isMaximized?: boolean;
  /** Shrunk to a tight header by the header's minimize button. */
  isMinimized?: boolean;
  zIndex?: number;
  onActivate: (id: string) => void;
  onUpdate?: (id: string, updates: Partial<Step>) => void;
  onRun: (id: string) => void;
  onPreview?: (id: string) => void;
  onPause: (id: string) => void;
  onDelete: (id: string) => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  /** The header's minimize button: hide the step UI, shrink the header. */
  onMinimizeStep?: () => void;
  /** Every step's name, so a new select step gets a unique one. */
  allStepNames?: string[];
  /** Insert a step (name, formula) just before this one; returns its id. */
  onInsertStepBefore?: (label: string, formula: string) => string;
  /** Replace another step's formula (a select step this one made). */
  onSetStepFormula?: (id: string, formula: string) => void;
  /** Called with the pointer position when the user drags the header far enough to detach */
  onDetach?: (position: { x: number; y: number }) => void;
  /** Live progress for row-iterating operations */
  progress?: ProgressEvent;
  pipelineStatus?: 'idle' | 'running' | 'paused';
  pipelineCursorIndex?: number;
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
  onPreview,
  onDelete,
  onMinimize,
  onMaximize,
  onMinimizeStep,
  allStepNames = [],
  onInsertStepBefore,
  onSetStepFormula,
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
  const { wiringState, activateWiring, deactivateWiring, pickFrom, setActiveSelection } = useStepWiring();
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
  const formulaBarRef = useRef<HTMLTextAreaElement | null>(null);

  // ── Picking data from an earlier step ────────────────────────────────────
  // A pick (whole table, columns, rows) becomes a select operation — see
  // utils/selection.ts. The formula bar is written through its hidden
  // textarea plus an `input` event, the same path typing takes, so the
  // formula is parsed and committed exactly as if it had been typed.

  /** The select step this step made while its formula was being written. */
  const madeSelectStep = useRef<{ id: string; name: string; selection: Selection } | null>(null);

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

  /** Insert *text* at the formula bar's caret — only the text, nothing added.
   *  The caret is the one Monaco last had (FormulaEditor keeps it on the
   *  element), since a grid click has already blurred the formula bar. */
  const insertAtCursor = (text: string) => {
    const el = formulaBarRef.current;
    if (!el) return;
    // The common case doesn't depend on the caret: a formula waiting for its
    // input — `tool[mod.verb()](` or `…]()` — takes the reference inside the
    // call, which is the only place an input can go.
    const open = /^(.*)\(\s*(\))?\s*$/s.exec(el.value);
    if (open && /\]\s*$/.test(open[1])) {
      const value = `${open[1]}(${text})`;
      writeFormulaBar(value, value.length);
      return;
    }
    const clamp = (n: number) => Math.max(0, Math.min(el.value.length, n));
    const start = clamp(Number(el.dataset.selStart ?? el.selectionStart ?? el.value.length));
    const end = clamp(Number(el.dataset.selEnd ?? start));
    writeFormulaBar(el.value.slice(0, start) + text + el.value.slice(end), start + text.length);
  };

  const handleReferencePick = (sourceStep: string, pick: GridPick) => {
    const current = formulaBarRef.current?.value ?? step.formula ?? '';
    const body = current.trim().replace(/^=/, '').trim();
    const ownSelection = parseSelectionFormula(current);

    // An empty formula, or one that is already a selection: the pick writes
    // this step's own select operation.
    if (!body || ownSelection) {
      const prev = ownSelection && ownSelection.step === sourceStep ? ownSelection : null;
      writeFormulaBar(selectionFormula(applyPick(prev, sourceStep, pick)));
      return;
    }

    // Writing some other formula: a whole table is just a reference.
    if (pick.kind === 'all') {
      insertAtCursor(stepRef(sourceStep));
      return;
    }

    // Part of a step: its own select step, just before this one, referenced
    // here. Picking again updates that same select step.
    const made = madeSelectStep.current;
    if (made && made.selection.step === sourceStep && current.includes(stepRef(made.name))) {
      const next = applyPick(made.selection, sourceStep, pick);
      madeSelectStep.current = { ...made, selection: next };
      onSetStepFormula?.(made.id, selectionFormula(next));
      setActiveSelection(next);
      return;
    }
    const selection = applyPick(null, sourceStep, pick);
    const name = selectStepName(selection, new Set(allStepNames));
    const id = onInsertStepBefore?.(name, selectionFormula(selection));
    if (!id) return;
    madeSelectStep.current = { id, name, selection };
    insertAtCursor(stepRef(name));
  };

  // The formula bar always reflects step.formula (the canonical field).
  // buildFormula is only used as a fallback for legacy steps that predate
  // the formula field (i.e. loaded from old save files without a formula).
  // With the backend model_validator fix, step.formula should always be set,
  // but we keep this client-side fallback for resilience.
  const currentOp = availableOperations.find(op => op.id === step.process_type);
  const hasParams = currentOp && currentOp.params && currentOp.params.length > 0;

  // `derivedFormula` is async because buildFormula() round-trips to the backend
  // for legacy steps without a saved formula. We cache the result in state and
  // recompute whenever the inputs change.
  const [derivedFormula, setDerivedFormula] = useState<string>(step.formula || '');
  useEffect(() => {
    let cancelled = false;
    if (step.formula) {
      setDerivedFormula(step.formula);
      return;
    }
    (async () => {
      const f = await buildFormula(
        step.process_type,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        step.configuration as Record<string, any>,
        (step.configuration._orchestrator as OrchestrationMode | undefined)
          ?? (currentOp?.type as OrchestrationMode | undefined)
          ?? null,
      );
      if (!cancelled) setDerivedFormula(f);
    })();
    return () => { cancelled = true; };
  }, [step.formula, step.process_type, step.configuration, currentOp?.type]);

  // ── Staged preview state ───────────────────────────────────────────────────
  // Track what the user is typing live — separate from committed step.formula
  // Prefer step.formula first, then derivedFormula, then legacy operation field.
  const [liveFormula, setLiveFormula] = useState<string>(step.formula || derivedFormula || step.operation || '');

  // While this step's formula bar is the one receiving picks, tell the source
  // grids what it selects, so the selected columns / rows stay highlighted.
  const isReceiving = wiringState.receivingStepId === step.id;
  useEffect(() => {
    if (!isReceiving) return;
    const own = parseSelectionFormula(liveFormula);
    const made = madeSelectStep.current;
    setActiveSelection(own ?? (made && liveFormula.includes(stepRef(made.name)) ? made.selection : null));
  }, [isReceiving, liveFormula, setActiveSelection]);

  // Keep liveFormula in sync when the step is updated externally.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLiveFormula(step.formula || derivedFormula || step.operation || '');
  }, [step.formula, step.operation, derivedFormula]);

  // Parse the live formula so the staged preview hook gets a typed ParsedFormula.
  // parseFormula is async (it round-trips to the backend) so we cache the result
  // in state instead of useMemo.
  const [liveParsed, setLiveParsed] = useState<ParsedFormula | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!liveFormula) {
      setLiveParsed(null);
      return;
    }
    parseFormula(liveFormula).then((p) => {
      if (!cancelled) setLiveParsed(p);
    });
    return () => { cancelled = true; };
  }, [liveFormula]);

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

  const isScheduledInPipeline =
    pipelineStatus === 'running' &&
    step.status === 'pending' &&
    pipelineCursorIndex >= 0 &&
    stepIndex >= pipelineCursorIndex;

  // The status pill shows a spinner while the step runs, and a dimmer one
  // while it waits its turn in a running pipeline.
  const isRunning = step.status === 'running';
  const isQueued = !isRunning && isScheduledInPipeline;
  const statusLabel = isQueued ? 'queued' : step.status;
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

  const showExecutionStagedCells =
    hasUncommittedFormula ||
    step.status === 'running' ||
    isScheduledInPipeline;

  // Handler for UI-based updates (Dropdowns/Inputs in the Details tab)
  // The UI form writes to the formula FIRST; process_type and configuration
  // are derived from the formula and kept in sync.
  const handleUiUpdate = async (updates: Partial<Step>) => {
    const newOpId = updates.process_type !== undefined ? updates.process_type : step.process_type;
    const newConfig = updates.configuration !== undefined ? updates.configuration : step.configuration;
    // Preserve the orchestration modifier already in the formula if no config override
    const existingParsed = step.formula ? await parseFormula(step.formula) : null;
    const orchMode = (newConfig._orchestrator as import('../utils/formulaParser').OrchestrationMode | undefined)
      ?? existingParsed?.orchestration
      ?? currentOp?.type as import('../utils/formulaParser').OrchestrationMode | undefined
      ?? null;
    const newFormula = await buildFormula(newOpId, newConfig, orchMode);
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
                        <span className="op-status-indicator">{statusSpinner}{statusLabel}</span>
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
              onDelete={() => onDelete(step.id)}
              openPanels={openPanels}
              onTogglePanel={togglePanel}
              onFormulaChange={handleFormulaUpdate}
              externalFormula={derivedFormula}
              isLocked={isLocked}
              onLock={() => setIsLocked(!isLocked)}
              onFormulaBarRef={(el) => { formulaBarRef.current = el; }}
              onReferencePick={handleReferencePick}
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
              </StepWidget>
              )}

              {/* Details (Function) Tab Content - Edit Functionality */}
              {isOpen('details') && isEditMode && (
                <StepWidget id="details" collapsed={collapsedPanels.has('details')} onToggleCollapse={toggleCollapsed} background="#ebf5fb" maxHeight={widgetMaxHeight}>
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
                          onPick={(source, pick) => {
                            const el = formulaBarRef.current;
                            if (el) activateWiring(step.id, stepIndex, { current: el } as React.RefObject<HTMLTextAreaElement>, handleReferencePick);
                            handleReferencePick(source, pick);
                          }}
                        />
                      )}

                      {/* Orchestration: core's verb for this tool, and its settings */}
                      {currentOp && currentOp.type !== 'verb' && (
                        <OrchestrationControl
                          configuration={step.configuration}
                          defaultType={currentOp.type}
                          onChange={(newConfig) => handleUiUpdate({ configuration: newConfig })}
                        />
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
                                {/* A parameter annotated Literal[...] carries its allowed
                                    values, so it gets a dropdown instead of a free-text box
                                    and a typo can no longer reach the engine. The current
                                    value is kept as an extra option when it is not one of
                                    them — a wired reference or a value from an older save
                                    must never be silently replaced. */}
                                {param.options && param.options.length > 0 ? (
                                  <select
                                    value={paramVal}
                                    title={param.description}
                                    onChange={(e) => {
                                      handleUiUpdate({
                                        configuration: { ...step.configuration, [param.name]: e.target.value },
                                      });
                                      onPreview?.(step.id);
                                    }}
                                    style={{ width: '100%', boxSizing: 'border-box' }}
                                  >
                                    {!param.options.map(String).includes(paramVal) && (
                                      <option value={paramVal}>
                                        {paramVal === '' ? '— choose —' : `${paramVal} (not a valid choice)`}
                                      </option>
                                    )}
                                    {param.options.map((opt) => (
                                      <option key={String(opt)} value={String(opt)}>{String(opt)}</option>
                                    ))}
                                  </select>
                                ) : (
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
                                )}
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
              </StepWidget>
              )}

              {/* Data Tab Content */}
              {isOpen('data') && (
                <StepWidget id="data" collapsed={collapsedPanels.has('data')} onToggleCollapse={toggleCollapsed} background="#1e1e1e" maxHeight={widgetMaxHeight}>
                  <div
                    className="tab-content status-content"
                    onMouseEnter={() => { if (isWiringSource) setIsWiringHovered(true); }}
                    onMouseLeave={() => setIsWiringHovered(false)}
                    style={isWiringSource && isWiringHovered ? { outline: '2px solid #ffc107', outlineOffset: -2, borderRadius: 4 } : {}}
                  >
                    <div className="expander-inner data-grid-expander" onClick={(e) => e.stopPropagation()}>
                      <DataOutputGrid
                        cells={step.output_preview}
                        wiringMode={isWiringSource}
                        onPick={(pick) => pickFrom(step.label, pick)}
                        highlight={wiringState.activeSelection?.step === step.label ? wiringState.activeSelection : null}
                        stagedColumns={showExecutionStagedCells ? stagedPreview.columns : []}
                        stagedCellMode={stagedCellMode}
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

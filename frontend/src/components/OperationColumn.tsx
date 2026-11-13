import { useEffect, useRef, useState } from 'react';
import type { Step, StepRow } from '../types/models';
import type { OperationDefinition, ResourceDeclaration } from '../services/api';
import type { ProgressEvent } from '../services/api';
import DataOutputGrid from './DataOutputGrid';
import StepToolbar from './StepToolbar';
import type { FormulaSummary } from './FormulaEditor';
import { placePick, stepRef } from '../utils/selection';
import type { GridPick, PlacedPick } from '../utils/selection';
import { parseFormula } from '../utils/formulaParser';
import type { FormulaReference, FormulaSpans, ParsedFormula } from '../utils/formulaParser';
import { useStepColor } from '../context/StepPaletteContext';
import ToolEditor from './ToolEditor';
import StepWidget from './StepWidget';
import type { PanelId } from './stepPanels';
import StepOverview from './StepOverview';
import StepMenu from './StepMenu';
import SymbolIcon, { type SymbolName } from './SymbolIcon';
import { runState, RUN_ICON } from '../utils/runState';
import Markdown from 'react-markdown';
import { useStepWiring } from '../context/StepWiringContext';
import { useSetGridHover } from '../context/StepsStatusContext';
import { useDragToDetach } from '../hooks/useDragToDetach';
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
  /** Run every step (the pipeline): the run controls' "Run all steps". */
  onRunAll?: () => void;
  /** Run this step and every step after it (the toolbar's "Run to the end"). */
  onRunToEnd?: () => void;
  /** Show page *page* of the step's rows (the grid's pager). */
  onRowPage?: (page: number) => void;
  /** Move this step to a position, 0 the first. */
  onMove?: (to: number) => void;
  /** How many steps the workflow has. */
  stepCount?: number;
  /** Declare the workflow, running nothing (Enter in the formula bar). */
  onDeclare?: () => void;
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
  /** A drag starts at the open step's left or right side: resize its width. */
  onResizeStart?: (edge: 'left' | 'right', e: React.PointerEvent) => void;
  /** Double-click on a side: back to the default width. */
  onResizeReset?: () => void;
}

/** The rows of an open step its Settings can hide, top to bottom. */
const ROW_TOGGLES: { row: StepRow; icon: SymbolName; label: string; hint: string }[] = [
  { row: 'controls', icon: 'tune', label: 'Step controls', hint: 'The first row: Run, Step Panels, Manage Step' },
  { row: 'formula', icon: 'function', label: 'Formula bar', hint: 'The second row: fx and the formula' },
  { row: 'data', icon: 'dataset', label: 'Data', hint: "The third row: the step's data" },
];

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
  onRunAll,
  onRunToEnd,
  onRowPage,
  onMove,
  stepCount,
  onDeclare,
  onDelete,
  onMinimize,
  onMaximize,
  onMinimizeStep,
  resources,
  onDefineResource,
  onDetach,
  onResizeStart,
  onResizeReset,
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
  // (F8): boxed dotted in the formula bar in the colour of the step it reads,
  // and, while this formula bar has focus, outlined in the source step's grid
  // in this step's colour (owner, 2026-10-30).
  const [refsOf, setRefsOf] = useState<{ formula: string; refs: FormulaReference[]; spans?: FormulaSpans }>({ formula: '', refs: [] });
  useEffect(() => {
    if (refsOf.formula === savedFormula) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      parseFormula(savedFormula)
        .then((p) => { if (!cancelled) setRefsOf({ formula: savedFormula, refs: p.references ?? [], spans: p.spans }); })
        .catch(() => {});
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [savedFormula, refsOf.formula]);
  const stepColor = useStepColor();
  const colorOf = Object.fromEntries(previousSteps.map((s, i) =>
    [s.label, s.step_color ?? stepColor(i, stepCount ?? previousSteps.length + 1)]));
  // The formula bar at rest (owner, 2026-11-12): TOOL(DATA) in the editor's
  // colours, or DATA alone for a data step; the whole expression while it's
  // being edited or the fx panel is open.
  const formulaSummary = isOpen('details') ? undefined
    : refsOf.formula === savedFormula ? summarize(savedFormula, refsOf.spans, refsOf.refs) : undefined;
  const barReferences = refsOf.refs.map((r) => ({ start: r.span[0], end: r.span[1], color: colorOf[r.step] ?? '#888' }));

  // A new round of picking starts fresh: the last pick is only replaced while
  // this formula bar is still receiving.
  const isReceiving = wiringState.receivingStepId === step.id;
  useEffect(() => {
    if (!isReceiving) lastPick.current = null;
  }, [isReceiving]);
  useEffect(() => {
    if (isReceiving) setReferences(refsOf.refs.map((r) => ({ ...r, reader: step.label })), color);
  }, [isReceiving, refsOf.refs, color, setReferences, step.label]);

  const isScheduledInPipeline =
    pipelineStatus === 'running' &&
    step.status === 'pending' &&
    pipelineCursorIndex >= 0 &&
    stepIndex >= pipelineCursorIndex;

  // Where the step's run stands (utils/runState.ts), the same as on the
  // steps' map: the colour of the header's sides, an icon at its tail, a
  // word at its bottom centre (owner, 2026-11-10). A staged step has no icon.
  const run = runState(step, isScheduledInPipeline);
  const runIconName = RUN_ICON[run.kind];
  const runIcon = runIconName && (
    <span className={`step-run-icon run-icon-${run.kind}`} title={run.text}>
      <SymbolIcon name={runIconName} size={15} />
    </span>
  );
  // What core runs, when it differs from what was written: the verb it
  // decided, the bindings it wrote (core S3).
  const coreRuns = step.coreFormula && step.coreFormula.replace(/^=/, '') !== (step.formula ?? '').replace(/^=/, '').trim()
    ? step.coreFormula : undefined;

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
    setRefsOf({ formula, refs: parsed.references ?? [], spans: parsed.spans });
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
    if (detachDrag.consumeClick()) return;
    if (isActive) {
      if (onMinimize) onMinimize();
    } else {
      onActivate(step.id);
    }
  };

  // ── Drag-to-detach on header ──────────────────────────────────────────────
  const detachDrag = useDragToDetach(onDetach);
  const isDragHinting = detachDrag.hinting;
  const handleHeaderMouseDown = detachDrag.onMouseDown;

  // The step's notes (owner, 2026-11-10): the notepad at the header's bottom
  // right drops them down under the header; hover them for the button that
  // edits them. A step without notes opens straight to editing.
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesEditing, setNotesEditing] = useState(false);
  const hasNotes = !!step.notes?.trim();
  const toggleNotes = () => {
    setNotesEditing(!notesOpen && !hasNotes);
    setNotesOpen(!notesOpen);
  };
  /** Done editing: back to reading them, or folded if there are none. */
  const finishNotes = () => {
    setNotesEditing(false);
    if (!step.notes?.trim()) setNotesOpen(false);
  };
  const [showRowsOpen, setShowRowsOpen] = useState(false);
  const stepSettings = (
      <div className="settings-content">
         <div className="config-item">
            <label>Step Name</label>
            <input
              type="text"
              value={step.label}
              onChange={(e) => onUpdate?.(step.id, { label: e.target.value })}
              placeholder="Enter step name..."
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
         <div className="summary-item">
            <span className="label">Step ID:</span>
            <span className="value" style={{ fontFamily: 'monospace', fontSize: '0.75em' }}>{step.id}</span>
         </div>
         <div className="summary-item">
            <span className="label">Status:</span>
            <span className={`status-badge status-${step.status}`}>{run.text}</span>
         </div>
         {/* Core's reasons the step can't run or is suspect. */}
         {!!step.problems?.length && (
           <div className="summary-item step-problems" data-testid="step-problems">
             <span className="label">Problems:</span>
             <ul className="value">
               {step.problems.map((p) => <li key={p}>{p}</li>)}
             </ul>
           </div>
         )}
         {coreRuns && (
           <div className="summary-item" data-testid="step-core-formula">
             <span className="label">Core runs:</span>
             <code className="value step-core-formula">{coreRuns}</code>
           </div>
         )}
         {/* Core's warnings from the last run (spec 009 REQ-RUN-002). */}
         {!!step.warnings?.length && (
           <div className="summary-item step-warnings" data-testid="step-warnings">
             <span className="label">Warnings:</span>
             <ul className="value">
               {step.warnings.map((w) => <li key={w}>{w}</li>)}
             </ul>
           </div>
         )}
         {/* Show: which rows of the open step are on (owner, 2026-11-13). Its
             own section, folded until opened, in the Step Panels menu's look. */}
         <div className="step-rows">
           <button
             type="button"
             className={`step-rows-head${showRowsOpen ? ' open' : ''}`}
             aria-expanded={showRowsOpen}
             title={showRowsOpen ? 'Fold' : "Choose which of the step's rows show"}
             onClick={() => setShowRowsOpen((o) => !o)}
           >
             Show
             <SymbolIcon name="chevron_right" size={14} className="step-rows-caret" />
           </button>
           {showRowsOpen && ROW_TOGGLES.map(({ row, icon, label, hint }) => {
             const shown = !step.hidden_rows?.includes(row);
             return (
               <button
                 key={row}
                 type="button"
                 role="menuitemcheckbox"
                 aria-checked={shown}
                 className={`step-menu-item${shown ? ' checked' : ''}`}
                 title={hint}
                 onClick={() => {
                   const hidden = new Set(step.hidden_rows ?? []);
                   if (shown) hidden.add(row); else hidden.delete(row);
                   onUpdate?.(step.id, { hidden_rows: hidden.size ? [...hidden] : undefined });
                 }}
               >
                 <SymbolIcon name={icon} size={15} />
                 <span className="step-menu-label">{label}</span>
                 <span className="step-menu-check">{shown && <SymbolIcon name="check" size={14} />}</span>
               </button>
             );
           })}
         </div>
      </div>
  );

  return (
    <div
      ref={columnRef}
      className={`operation-column ${isActive ? 'active' : ''} ${isMaximized ? 'maximized' : ''} ${isSqueezed ? 'squeezed' : ''} ${isMinimized ? 'minimized' : ''} status-${step.status} run-${run.kind}`}
      style={{ 
        '--step-color': color,
        zIndex: zIndex,
      } as React.CSSProperties}
      data-testid={`operation-column-${step.id}`}
    >
      <div className={`op-header${isDragHinting ? ' drag-detach-hint' : ''}`} onClick={handleColumnClick} onMouseDown={handleHeaderMouseDown} style={{ cursor: 'pointer', position: 'relative' }}>
        {/* The run's colour: the outer arrow, showing round the fill's sides. */}
        <div className="arrow-status run-paint" aria-hidden="true" />
        <div className="arrow-background" />
        <div className="arrow-content">
            {isMinimized ? (
                 // As small as it gets: just the step's number (owner, 2026-10-30).
                 <span className="vertical-label" title={`Step ${stepIndex + 1} · ${step.label} · ${run.text}`}>{stepIndex + 1}</span>
            ) : isSqueezed ? (
                 <span className="vertical-label">{step.label}</span>
            ) : (
                <div className="header-titles header-one-line">
                    <h3 className="op-name">{step.label}</h3>
                </div>
            )}
        </div>
        {/* The run's icon, just ahead of the tail; hover it for the status
            (owner, 2026-11-10: no status word under the name). */}
        {!isMinimized && runIcon}
        {/* Hover controls — bottom right of the header: the notes' notepad,
            settings, minimize, maximize. They stop mousedown so a click never
            starts the header's drag-to-detach. */}
        <div
          className="step-header-controls"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {!isMinimized && !isSqueezed && (
            <button
              type="button"
              className={`step-header-btn step-notes-toggle${notesOpen ? ' open' : ''}`}
              aria-expanded={notesOpen}
              aria-label={notesOpen ? `Fold ${step.label}'s notes` : hasNotes ? `Show ${step.label}'s notes` : `Add notes to ${step.label}`}
              title={notesOpen ? 'Fold the notes' : hasNotes ? `Notes: ${firstLine(step.notes!)}` : 'Add notes'}
              data-testid="step-notes-toggle"
              onClick={toggleNotes}
            >
              <SymbolIcon name="sticky_note_2" size={12} />
              <SymbolIcon name="arrow_drop_down" size={12} className="step-notes-chevron" />
            </button>
          )}
          {!isMinimized && !isSqueezed && (
            <StepMenu icon="tune" iconSize={13} label="Step settings" testId="step-settings" className="step-header-btn" align="right">
              {stepSettings}
            </StepMenu>
          )}
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

      {/* Open, the notes are a Markdown description under the header, in
          its colour; hovered, a notepad button edits them in place (saved
          as the step's meta.notes). Not on a minimized or squeezed step. */}
      {!isMinimized && !isSqueezed && notesOpen && (
        <div className="step-notes-header" onClick={(e) => e.stopPropagation()}>
          {notesEditing ? (
            <textarea
              autoFocus
              className="step-notes-inline-input"
              aria-label={`${step.label}'s notes (Markdown)`}
              rows={6}
              value={step.notes ?? ''}
              onChange={(e) => onUpdate?.(step.id, { notes: e.target.value || undefined })}
              onBlur={finishNotes}
              onKeyDown={(e) => { if (e.key === 'Escape') e.currentTarget.blur(); }}
              placeholder="What is this step for? Markdown, e.g. **Keeps** only rows with a score over 5."
            />
          ) : (
            <>
              <div className="step-notes-body"><Markdown>{step.notes}</Markdown></div>
              <button
                type="button"
                className="step-header-btn step-notes-edit-btn"
                title="Edit the notes"
                aria-label={`Edit ${step.label}'s notes`}
                data-testid="step-notes-edit"
                onClick={() => setNotesEditing(true)}
              >
                <SymbolIcon name="edit_note" size={14} />
              </button>
            </>
          )}
        </div>
      )}

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
        {/* Drag either side of an open step to make it wider or narrower;
            double-click to go back to the default (owner, 2026-11-10). */}
        {onResizeStart && isActive && !isSqueezed && !isMaximized && !isMinimized && (['left', 'right'] as const).map((edge) => (
          <div
            key={edge}
            className={`step-width-handle step-width-handle--${edge}`}
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize ${step.label} (${edge} side)`}
            title="Drag to resize · double-click for the default width"
            onPointerDown={(e) => onResizeStart(edge, e)}
            onDoubleClick={(e) => { e.stopPropagation(); onResizeReset?.(); }}
            onClick={(e) => e.stopPropagation()}
          />
        ))}
        <div className="op-body-inner">
          {!isSqueezed && (
            <StepToolbar
              key={step.id}
              step={step}
              stepIndex={stepIndex}
              availableOperations={availableOperations}
              onRun={() => onRun(step.id)}
              onDeclare={onDeclare}
              onRunAll={onRunAll}
              onRunToEnd={onRunToEnd}
              onMove={onMove}
              stepCount={stepCount}
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
              formulaSummary={formulaSummary}
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

              {/* The Formula panel: no name bar, f(x) opens and closes it (owner, 2026-10-30). */}
              {isOpen('details') && isEditMode && (
                <StepWidget id="details" bare collapsed={false} onToggleCollapse={toggleCollapsed} background="#1e1e1e" maxHeight={widgetMaxHeight}>
                  <div className="tab-content details-content">
                    <div className="expander-inner" onClick={(e) => e.stopPropagation()}>
                      {/* The formula as a form: Tool, then Inputs and Modifiers. */}
                      <ToolEditor
                        formula={savedFormula}
                        availableOperations={availableOperations}
                        previousSteps={previousSteps}
                        resources={resources as Record<string, ResourceDeclaration> | undefined}
                        onDefineResource={onDefineResource}
                        problems={step.problems}
                        bindings={step.bindings}
                        onChange={(formula, parsed) => {
                          handleFormulaUpdate(step.id, formula, parsed);
                        }}
                      />
                    </div>
                  </div>
              </StepWidget>
              )}

              {/* Data Tab Content */}
              {isOpen('data') && !step.hidden_rows?.includes('data') && (
                // No name bar: the table's own header (Data ▸ / wf["step"] \ size) folds it (dev_plan/133 §2).
                <StepWidget id="data" bare collapsed={false} onToggleCollapse={toggleCollapsed} background="#1e1e1e" maxHeight={widgetMaxHeight}>
                  <div
                    className="tab-content status-content"
                  >
                    <div className="expander-inner data-grid-expander" onClick={(e) => e.stopPropagation()}>
                      <DataOutputGrid
                        cells={step.output_preview}
                        refId={step.outputRefId}
                        wiringMode={isWiringSource}
                        onPick={(pick) => pickFrom(step.label, pick)}
                        columns={step.viewColumns}
                        planNote={planNote}
                        rowCount={step.outputRows}
                        page={step.rowPage ?? 0}
                        onPage={onRowPage}
                        stagedCellMode={stagedCellMode}
                        onHoverChange={(spot) => setGridHover(spot && { ...spot, step: step.label })}
                        collapsed={collapsedPanels.has('data')}
                        onToggleCollapsed={() => toggleCollapsed('data')}
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

/**
 * The formula at rest (owner, 2026-11-10): `tool*(data)` — the tool, a `*`
 * when it has modifiers (details not shown), then its data and settings,
 * without the `=`. Where the tool and modifiers are is core's (the parse's
 * spans); a formula without modifiers, or not parsed yet, shows as written.
 */
/**
 * The bar at rest: `TOOL(DATA)*`. The data is the step it runs over, by
 * name; the `*` says there's more (modifiers, arguments) behind a click.
 */
function summarize(formula: string, spans: FormulaSpans | undefined, refs: FormulaReference[]): FormulaSummary | undefined {
  const tool = spans?.tool;
  if (!tool) {
    // Data alone, `=wf["step"]`: just the data variable (owner, 2026-11-12).
    const only = refs.length === 1 ? refs[0] : undefined;
    const whole = formula.trim().replace(/^=/, '').trim();
    return only && whole === formula.slice(only.span[0], only.span[1]).trim() ? { data: only.step } : undefined;
  }
  const input = spans?.input;
  const data = input
    ? refs.find((r) => r.span[0] >= input[0] && r.span[1] <= input[1])?.step ?? formula.slice(input[0], input[1])
    : '';
  return { tool: formula.slice(tool[0], tool[1]), data };
}

/** A note's first line, as plain text: its title when it's folded (Markdown marks dropped). */
function firstLine(notes: string): string {
  const line = notes.trim().split('\n').find((l) => l.trim()) ?? '';
  return line.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim();
}

import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import type { PanelId } from './stepPanels';
import { PANEL_META } from './stepPanels';
import type { SymbolName } from './SymbolIcon';

/** Each panel's icon in the Panels menu. */
const PANEL_ICON: Record<'overview' | 'data' | 'settings', SymbolName> = {
  overview: 'analytics',
  data: 'database',
  settings: 'settings',
};
import type { GridPick } from '../utils/selection';
import type { Step } from '../types/models';
import type { OperationDefinition } from '../services/api';
import { formatFormula, parseFormula } from '../utils/formulaParser';
import { partsForTool } from '../utils/formulaParts';
import type { ParsedFormula } from '../utils/formulaParser';
import { useStepWiring } from '../context/StepWiringContext';
import SymbolIcon from './SymbolIcon';
import StepMenu from './StepMenu';

// Lazy-load the Monaco-backed formula editor so the ~2 MB editor bundle
// stays out of the initial JS payload.  While it's loading we render a
// plain textarea fallback so the user can still type immediately.
const FormulaEditor = lazy(() => import('./FormulaEditor'));

/** Visual colour coding for each orchestration mode — used in the autocomplete dropdown. */
const ORCHESTRATION_BADGE_COLORS: Record<string, { bg: string; fg: string }> = {
  source:       { bg: '#e8f5e9', fg: '#2e7d32' },
  map:          { bg: '#e3f2fd', fg: '#1565c0' },
  filter:       { bg: '#fff3e0', fg: '#e65100' },
  dataframe:    { bg: '#f3e5f5', fg: '#6a1b9a' },
  expand:       { bg: '#fce4ec', fg: '#880e4f' },
  raw_output:   { bg: '#f5f5f5', fg: '#424242' },
  orchestrator: { bg: '#e8eaf6', fg: '#283593' }, // built-in ss_* ops
};

interface StepToolbarProps {
  step: Step;
  /** Index of this step in the pipeline (0-based) — used for wiring eligibility */
  stepIndex?: number;
  availableOperations?: OperationDefinition[];
  onRun?: (id: string) => void;
  /** Run every step (the pipeline). */
  onRunAll?: () => void;
  /** Move this step to a position, 0 the first (core's `k.move`). */
  onMove?: (to: number) => void;
  /** How many steps the workflow has, so a move knows its ends. */
  stepCount?: number;
  /** Enter in the formula bar: declare the step, running nothing. */
  onDeclare?: () => void;
  onDelete?: (id: string) => void;
  onEdit?: (id: string) => void;
  onFormulaChange?: (id: string, formula: string, parsed: ParsedFormula) => void;
  /** The step a newly chosen tool reads by default (wf["…"]); null for the first step. */
  previousStep?: string | null;
  // Allow parent to push a formula update (from UI config changes → formula bar)
  externalFormula?: string;
  // Widget toggles — any number of widgets can be open at once
  openPanels: PanelId[];
  onTogglePanel: (panel: PanelId) => void;
  onLock?: (id: string) => void;
  isLocked?: boolean;
  onConfigure?: (id: string) => void;
  /** Called once with a ref to the formula bar input so parents can focus it. */
  onFormulaBarRef?: (ref: HTMLTextAreaElement | null) => void;
  /** A pick in an earlier step's grid while this formula bar has focus. */
  onReferencePick?: (sourceStep: string, pick: GridPick) => void;
  /** The formula's step references and their steps' colours, drawn dashed in the bar (R3). */
  references?: { start: number; end: number; color: string }[];
}

export default function StepToolbar({ 
  step,
  stepIndex = 0,
  availableOperations = [], 
  onRun, 
  onDeclare,
  onRunAll,
  onMove,
  stepCount = 1,
  onDelete, 
  onFormulaChange,
  previousStep = null,
  externalFormula,
  openPanels,
  onTogglePanel,
  onLock,
  isLocked,
  onFormulaBarRef,
  onReferencePick,
  references,
}: StepToolbarProps) {
  // Local state for immediate UI feedback
  const initFormula = step.formula || step.operation || '';
  const [formula, setFormula] = useState(initFormula);
  // Enter commits what the bar shows; read it through a ref so the handler
  // never sees an older formula than the one on screen.
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<OperationDefinition[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Wiring context — lets prior-step grids inject references into this formula bar
  const { activateWiring, deactivateWiring } = useStepWiring();

  // Sync from external formula updates (UI config → formula bar)
  // Use functional setState to compare against the *current* state, not a
  // stale closure value — this was the root cause of the formula bar showing
  // defaults after loading a workflow.
  useEffect(() => {
    if (externalFormula !== undefined) {
      setFormula(prev => {
        if (externalFormula !== prev) {
          console.log(`[StepToolbar SYNC externalFormula] step.id=${step.id} prev="${prev}" → new="${externalFormula}"`);
          return externalFormula;
        }
        return prev;
      });
    }
  }, [externalFormula, step.id]);

  // Sync with prop if the step data changes externally (e.g. workflow load)
  // Also uses functional setState to avoid stale-closure comparison.
  useEffect(() => {
    const canonical = step.formula || step.operation || '';
    setFormula(prev => {
      if (canonical !== prev) {
        console.log(`[StepToolbar SYNC step.formula] step.id=${step.id} prev="${prev}" → canonical="${canonical}"`);
        return canonical;
      }
      return prev;
    });
  }, [step.formula, step.operation, step.id]);

  const computeSuggestions = (value: string): OperationDefinition[] => {
    const raw = value.trim();
    // Show suggestions when user has typed '=' but hasn't opened parenthesis yet
    if (raw.startsWith('=') && !raw.includes('(')) {
      const partial = raw.slice(1).toUpperCase();
      return availableOperations.filter(op =>
        op.type !== 'verb' && op.type !== 'orchestrator' &&
        (op.id.toUpperCase().startsWith(partial) || op.label.toUpperCase().startsWith(partial))
      );
    }
    return [];
  };

  const handleInputChange = async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value;
    setFormula(newVal);

    const sugg = computeSuggestions(newVal);
    setSuggestions(sugg);
    setShowSuggestions(sugg.length > 0);

    const parsed = await parseFormula(newVal);
    onFormulaChange?.(step.id, newVal, parsed);
  };

  // Also respond to the native 'input' event fired by injectReference (context)
  // so that reference tokens inserted via pointer clicks also propagate up.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onNativeInput = (e: Event) => {
      const newVal = (e.target as HTMLTextAreaElement).value;
      setFormula(newVal);
      const sugg = computeSuggestions(newVal);
      setSuggestions(sugg);
      setShowSuggestions(sugg.length > 0);
      // Fire-and-forget async parse — the formula bar UI doesn't wait on it.
      void parseFormula(newVal).then((parsed) => {
        onFormulaChange?.(step.id, newVal, parsed);
      });
    };
    el.addEventListener('input', onNativeInput);
    return () => el.removeEventListener('input', onNativeInput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id]);

  // Auto-grow the formula textarea so long formulas wrap and become fully
  // visible instead of being clipped to one line.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [formula]);

  const handleSuggestionClick = async (op: OperationDefinition) => {
    setShowSuggestions(false);
    // The same writer as the Formula panel's Tool picker: core syntax, built by
    // the backend, reading the previous step unless the tool is a source.
    let newFormula: string;
    try {
      const res = await formatFormula(partsForTool(op.id, op.type, previousStep));
      newFormula = res.formula.startsWith('=') ? res.formula : `=${res.formula}`;
    } catch (e) {
      console.warn(`[StepToolbar] could not write a formula for ${op.id}:`, e);
      return;
    }
    setFormula(newFormula);
    const parsed = await parseFormula(newFormula);
    onFormulaChange?.(step.id, newFormula, parsed);
    // Re-focus and move cursor to end
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const len = newFormula.length;
        inputRef.current.setSelectionRange(len, len);
      }
    }, 0);
  };

  const isOpen = (panel: PanelId) => openPanels.includes(panel);

  return (
    <div className="toolbar-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px 4px', borderBottom: '1px solid #333' }}>

      {/* Two groups, side by side and centred, always on one line; a narrow
          step shows their icons without words (CSS container query). */}
      <div className="toolbar step-bar" data-testid="step-toolbar">

        {/* The step's control bar (owner, 2026-10-29; dev_plan/126 L1): Run and
            its controls at the left; at the right, step tools (the Formula
            panel), the panels menu (☰), settings, then managing the step.
            Each menu pops up over the page (StepMenu). */}
        <div className="step-bar-side">
        <button
          className="step-run-big"
          onClick={(e) => { e.stopPropagation(); onRun?.(step.id); }}
          title={step.status === 'running' ? 'Stop' : 'Run this step (⌘/Ctrl+Enter in the formula bar; Enter only stages it)'}
          aria-label={step.status === 'running' ? 'Stop' : 'Run this step'}
          data-testid="btn-run"
        >
          <SymbolIcon name={step.status === 'running' ? 'stop' : 'play_arrow'} size={18} />
          <span>{step.status === 'running' ? 'Stop' : 'Run Step'}</span>
        </button>
        <StepMenu
          icon="playlist_play"
          iconSize={20}
          label="Run options"
          testId="run-controls"
          className="step-menu-big"
          items={[
            { icon: step.status === 'running' ? 'stop' : 'play_arrow', label: step.status === 'running' ? 'Stop' : 'Run this step', hint: '⌘↵', onClick: () => onRun?.(step.id) },
            { icon: 'check', label: 'Stage this step', hint: '↵', onClick: () => onDeclare?.(), disabled: !onDeclare },
            { icon: 'play_circle', label: 'Run all steps', onClick: () => onRunAll?.(), disabled: !onRunAll },
          ]}
        />
        </div>
        <div className="step-bar-side">
        <StepMenu
          icon="splitscreen_add"
          iconSize={18}
          label="Step panels"
          text="Step Panels"
          testId="panels"
          className="step-bar-named"
          items={(['overview', 'data'] as const).map((panel) => ({
            icon: PANEL_ICON[panel],
            label: PANEL_META[panel].name,
            checked: isOpen(panel),
            onClick: () => onTogglePanel(panel),
            testId: `panel-${panel}`,
          }))}
        />
        <button
          className={`btn-icon step-menu-toggle step-bar-named${isOpen('settings') ? ' active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onTogglePanel('settings'); }}
          title="Settings"
          aria-label="Settings"
          aria-pressed={isOpen('settings')}
          data-testid="panel-settings"
        >
          <span className="step-menu-text">Settings</span>
          <SymbolIcon name="settings" size={18} />
        </button>
        {isLocked && <SymbolIcon name="lock" size={13} className="step-locked-mark" />}
        <StepMenu
          icon="swap_horiz"
          iconSize={18}
          label="Manage step"
          text="Manage Step"
          align="right"
          testId="step-management"
          className="step-bar-named"
          items={[
            { icon: 'arrow_back', label: 'Move left', onClick: () => onMove?.(stepIndex - 1), disabled: !onMove || stepIndex <= 0 },
            { icon: 'arrow_forward', label: 'Move right', onClick: () => onMove?.(stepIndex + 1), disabled: !onMove || stepIndex >= stepCount - 1 },
            { divider: true },
            { icon: isLocked ? 'lock_open' : 'lock', label: isLocked ? 'Unlock' : 'Lock', onClick: () => onLock?.(step.id) },
            { divider: true },
            { icon: 'delete', label: isLocked ? 'Delete (unlock first)' : 'Delete step', onClick: () => onDelete?.(step.id),
              disabled: isLocked, danger: true, testId: 'btn-delete' },
          ]}
        />
        </div>
      </div>

      {/* The f(x) button and the formula bar, on their own row */}
      <div
        className="formula-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          position: 'relative',
        }}
      >
        
        {/* Function Button (Fx Icon) - Activated Details */}
        <button
          className={`btn-icon step-fx${isOpen('details') ? ' active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onTogglePanel('details'); }}
          title="Formula: tool, parameters and modifiers"
        >
          fx
        </button>

        {/* The formula field: outlined, so it reads as an input, not text
            (owner, 2026-10-30); blue while being edited. */}
        <div className="step-formula-field" style={{ flex: 1, position: 'relative' }}>
          <Suspense
            fallback={
              <textarea
                ref={(el) => {
                  (inputRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
                  onFormulaBarRef?.(el);
                }}
                rows={1}
                value={formula}
                onChange={handleInputChange}
                placeholder="Loading editor…"
                style={{
                  width: '100%',
                  padding: '4px 8px',
                  border: '1px solid #3c3c3c',
                  background: '#1e1e1e',
                  color: '#d4d4d4',
                  borderRadius: '4px',
                  fontFamily: 'monospace',
                  boxSizing: 'border-box',
                  resize: 'none',
                  minHeight: '26px',
                  lineHeight: 1.4,
                }}
                data-testid="formula-input"
              />
            }
          >
            <FormulaEditor
            value={formula}
            references={references}
            onChange={(next) => {
              // Build a synthetic event so we reuse handleInputChange's logic
              // without duplicating its body.
              const fakeEvent = {
                target: { value: next },
              } as unknown as React.ChangeEvent<HTMLTextAreaElement>;
              handleInputChange(fakeEvent);
            }}
            onEnter={() => {
              setShowSuggestions(false);
              onDeclare?.();
            }}
            onModEnter={() => {
              setShowSuggestions(false);
              onRun?.(step.id);
            }}
            onBlur={() => {
              setTimeout(() => setShowSuggestions(false), 150);
              deactivateWiring();
            }}
            onFocus={() => {
              const sugg = computeSuggestions(formula);
              setSuggestions(sugg);
              setShowSuggestions(sugg.length > 0);
              if (inputRef.current) {
                activateWiring(step.id, stepIndex, inputRef as React.RefObject<HTMLTextAreaElement>, onReferencePick);
              }
            }}
            shadowRef={(el) => {
              (inputRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
              onFormulaBarRef?.(el);
            }}
            placeholder={availableOperations?.length
              ? `=operation.source(param="value") or =operation.map(col=step1.col)`
              : '=OPERATION.mode(param="value")'}
            testId="formula-input"
          />
          </Suspense>

          {/* Reference-misuse hint: user typed a bare step reference as a full formula
              but the step already has a real operation selected (not noop/passthrough).
              In noop/passthrough mode the reference IS valid — no hint needed. */}
          {/^[\w-]+\.\w+/.test(formula) && !formula.startsWith('=')
            && step.process_type !== 'passthrough'
            && step.process_type !== 'noop'
            && step.process_type !== '' && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              background: '#fff8e1',
              border: '1px solid #ffc107',
              borderRadius: '0 0 4px 4px',
              padding: '6px 10px',
              fontSize: '0.72rem',
              color: '#7b5e00',
              zIndex: 1000,
              lineHeight: 1.4,
            }}>
              <SymbolIcon name="lightbulb" size={13} /> <strong>Step references go inside an operation's argument.</strong>
              <br />
              e.g. <code style={{ background: '#fffde7', padding: '1px 4px', borderRadius: 3 }}>
                =MY_OP(col=<strong>{formula}</strong>)
              </code>
              <br />
              Use the <strong>fx</strong> tab → parameters, or type a full formula above.
            </div>
          )}

          {/* Pass-through confirmation: reference token set, ready to run */}
          {step.process_type === 'passthrough' && formula && !formula.startsWith('=') && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              background: '#e8f5e9',
              border: '1px solid #66bb6a',
              borderRadius: '0 0 4px 4px',
              padding: '4px 10px',
              fontSize: '0.72rem',
              color: '#2e7d32',
              zIndex: 1000,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}>
              <SymbolIcon name="check" size={13} /> Pass-through — hit <SymbolIcon name="play_arrow" size={13} /> to load this data into the step
            </div>
          )}

          {/* Autocomplete Dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              background: '#fff',
              border: '1px solid #ccc',
              borderRadius: '0 0 4px 4px',
              boxShadow: '0 4px 8px rgba(0,0,0,0.12)',
              zIndex: 1000,
              maxHeight: '180px',
              overflowY: 'auto',
            }}>
              {suggestions.map(op => (
                <div
                  key={op.id}
                  onMouseDown={() => handleSuggestionClick(op)}
                  style={{
                    padding: '6px 10px',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    fontSize: '13px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    borderBottom: '1px solid #f0f0f0',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f0f7ff')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 600, color: '#3498db' }}>{op.id}</span>
                    {op.type && (
                      <span style={{
                        fontSize: '10px',
                        fontFamily: 'monospace',
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: 3,
                        background: ORCHESTRATION_BADGE_COLORS[op.type]?.bg ?? '#eee',
                        color: ORCHESTRATION_BADGE_COLORS[op.type]?.fg ?? '#333',
                        letterSpacing: '0.03em',
                      }}>
                        {op.type}
                      </span>
                    )}
                  </div>
                  {op.label && op.label !== op.id && (
                    <span style={{ fontSize: '11px', color: '#888', fontFamily: 'sans-serif' }}>{op.label}</span>
                  )}
                  {op.description && (
                    <span style={{ fontSize: '10px', color: '#aaa', fontFamily: 'sans-serif', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{op.description}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tabs Bar Removed */}
      <div style={{ display: 'none' }}></div>
    </div>
  );
}

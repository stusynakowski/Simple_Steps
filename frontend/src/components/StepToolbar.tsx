import { useState, useEffect, useLayoutEffect, useRef, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import type { PanelId } from './stepPanels';
import type { GridPick } from '../utils/selection';
import type { Step } from '../types/models';
import type { OperationDefinition } from '../services/api';
import { formatFormula, parseFormula } from '../utils/formulaParser';
import { partsForTool } from '../utils/formulaParts';
import type { ParsedFormula } from '../utils/formulaParser';
import { useStepWiring } from '../context/StepWiringContext';
import SymbolIcon from './SymbolIcon';
import StepMenu from './StepMenu';
import { useHoverTip } from './useHoverTip';

// Lazy-load the Monaco-backed formula editor so the ~2 MB editor bundle
// stays out of the initial JS payload.  While it's loading we render a
// plain textarea fallback so the user can still type immediately.
const FormulaEditor = lazy(() => import('./FormulaEditor'));
import type { FormulaSummary } from './FormulaEditor';

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
  /** Enter in the formula bar: declare the step, running nothing. */
  onDeclare?: () => void;
  /** Run this step and every step after it (the run settings, ⋮). */
  onRunToEnd?: () => void;
  /** Run every step. */
  onRunAll?: () => void;
  onEdit?: (id: string) => void;
  onFormulaChange?: (id: string, formula: string, parsed: ParsedFormula) => void;
  /** The step a newly chosen tool reads by default (wf["…"]); null for the first step. */
  previousStep?: string | null;
  // Allow parent to push a formula update (from UI config changes → formula bar)
  externalFormula?: string;
  // Widget toggles — any number of widgets can be open at once
  openPanels: PanelId[];
  onTogglePanel: (panel: PanelId) => void;
  isLocked?: boolean;
  onConfigure?: (id: string) => void;
  /** Called once with a ref to the formula bar input so parents can focus it. */
  onFormulaBarRef?: (ref: HTMLTextAreaElement | null) => void;
  /** A pick in an earlier step's grid while this formula bar has focus. */
  onReferencePick?: (sourceStep: string, pick: GridPick) => void;
  /** The formula's step references and their steps' colours, drawn dashed in the bar (R3). */
  references?: { start: number; end: number; color: string }[];
  /** The formula at rest: TOOL(DATA), or DATA alone (owner, 2026-11-12). */
  formulaSummary?: FormulaSummary;
}

export default function StepToolbar({
  step,
  stepIndex = 0,
  availableOperations = [], 
  onRun,
  onDeclare,
  onRunToEnd,
  onRunAll,
  onFormulaChange,
  previousStep = null,
  externalFormula,
  openPanels,
  onTogglePanel,
  isLocked,
  onFormulaBarRef,
  onReferencePick,
  references,
  formulaSummary,
}: StepToolbarProps) {
  // Local state for immediate UI feedback
  const initFormula = step.formula || step.operation || '';
  const [formula, setFormula] = useState(initFormula);
  // Enter commits what the bar shows; read it through a ref so the handler
  // never sees an older formula than the one on screen.
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<OperationDefinition[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // The suggestions open over the whole page (a portal, fixed under the
  // field), as StepMenu's pop-ups do: inside the step they were covered by
  // the widgets below it.
  const fieldRef = useRef<HTMLDivElement>(null);
  const [dropAt, setDropAt] = useState<{ top: number; left: number; width: number } | null>(null);
  const suggestionsOpen = showSuggestions && suggestions.length > 0;
  useLayoutEffect(() => {
    if (!suggestionsOpen) { setDropAt(null); return; }
    const place = () => {
      const r = fieldRef.current?.getBoundingClientRect();
      if (r) setDropAt({ top: r.bottom, left: r.left, width: r.width });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [suggestionsOpen, formula]);

  // Wiring context — lets prior-step grids inject references into this formula bar
  const { activateWiring, deactivateWiring, wiringState } = useStepWiring();
  // While picking from other steps' grids the bar keeps the whole expression.
  const isPicking = wiringState.receivingStepId === step.id;

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
    // Every tool for an empty bar (clicking into a new step shows what it can
    // be); then the ones matching what's typed, until the call is opened.
    if (!raw || (raw.startsWith('=') && !raw.includes('(') && !raw.includes('['))) {
      const partial = raw.replace(/^=/, '').toUpperCase();
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
  const runLabel = step.status === 'running' ? 'Stop' : 'Run this step (⌘/Ctrl+Enter in the formula bar; Enter only stages it)';
  const runTip = useHoverTip(runLabel);

  // The formula row can be turned off in the step's settings (owner,
  // 2026-11-13). Hidden, not removed: it stays mounted for whoever focuses it.
  const hidden = !!step.hidden_rows?.includes('formula');

  return (
    // One row (owner, 2026-11-24): fx, the formula, then ▶ at its end. The
    // control bar above it is gone: the run options and managing the step
    // are in the header's ⋯ menu, so ▶ is the only arrow here.
    <div className="toolbar-wrapper" data-testid="step-toolbar" style={{ display: hidden ? 'none' : 'flex', flexDirection: 'column', gap: '4px', padding: '4px 4px', borderBottom: '1px solid #333' }}>

      {/* The f(x) button and the formula bar, on their own row */}
      <div
        className="formula-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          position: 'relative',
        }}
      >
        {/* ▶ at the start of the formula row (owner, 2026-11-24: it feels
            better on the left): run what's written (⌘/Ctrl+Enter does the
            same; Enter only stages). */}
        <button
          type="button"
          className={`step-run-inline${step.status === 'running' ? ' running' : ''}`}
          onClick={(e) => { e.stopPropagation(); onRun?.(step.id); }}
          aria-label={step.status === 'running' ? 'Stop' : 'Run this step'}
          data-testid="btn-run"
          {...runTip.tipProps}
        >
          <SymbolIcon name={step.status === 'running' ? 'stop' : 'play_arrow'} size={24} />
        </button>
        {runTip.tip}
        {/* ⋮, the run settings, is also the divider between running and the
            formula (owner, 2026-11-24): no line of its own. */}
        <StepMenu icon="more_vert" iconSize={20} label="Run settings" testId="run-controls" className="step-run-settings"
          items={[
            { icon: 'fast_forward', label: 'Run to the end', hint: 'this step and after', onClick: () => onRunToEnd?.(),
              disabled: !onRunToEnd, testId: 'btn-run-to-end' },
            { icon: 'check', label: 'Stage this step', hint: '↵', onClick: () => onDeclare?.(), disabled: !onDeclare },
            { icon: 'play_circle', label: 'Run all steps', onClick: () => onRunAll?.(), disabled: !onRunAll },
          ]}
        />
        {isLocked && <SymbolIcon name="lock" size={13} className="step-locked-mark" />}

        {/* Function Button (Fx Icon) - Activated Details */}
        <button
          className={`btn-icon step-fx${isOpen('details') ? ' active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onTogglePanel('details'); }}
          title={isOpen('details') ? 'Fold the formula panel' : 'Open the formula panel: tool, arguments and modifiers'}
          aria-expanded={isOpen('details')}
        >
          fx
          <SymbolIcon name="chevron_right" size={18} className="step-fx-caret" />
        </button>

        {/* The formula field: outlined, so it reads as an input, not text
            (owner, 2026-10-30); blue while being edited. */}
        <div ref={fieldRef} className="step-formula-field" style={{ flex: 1, position: 'relative' }}>
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
            summary={isPicking ? undefined : formulaSummary}
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
              ? `=tool[mod.map()](wf["step"], setting=1) — or press fx to build it`
              : '=tool[mod.map()](wf["step"])'}
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
          {suggestionsOpen && dropAt && createPortal(
            <div style={{
              position: 'fixed',
              top: dropAt.top,
              left: dropAt.left,
              width: dropAt.width,
              boxSizing: 'border-box',
              background: '#fff',
              border: '1px solid #ccc',
              borderRadius: '0 0 4px 4px',
              boxShadow: '0 4px 8px rgba(0,0,0,0.12)',
              zIndex: 10000,
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
            </div>,
            document.body,
          )}
        </div>

      </div>
    </div>
  );
}

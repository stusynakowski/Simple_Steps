import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import type { PanelId } from './stepPanels';
import type { Step } from '../types/models';
import type { OperationDefinition } from '../services/api';
import { parseFormula } from '../utils/formulaParser';
import type { ParsedFormula } from '../utils/formulaParser';
import { useStepWiring } from '../context/StepWiringContext';

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
  onDelete?: (id: string) => void;
  onEdit?: (id: string) => void;
  onFormulaChange?: (id: string, formula: string, parsed: ParsedFormula) => void;
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
}

export default function StepToolbar({ 
  step,
  stepIndex = 0,
  availableOperations = [], 
  onRun, 
  onDelete, 
  onFormulaChange,
  externalFormula,
  openPanels,
  onTogglePanel,
  onLock,
  isLocked,
  onFormulaBarRef,
}: StepToolbarProps) {
  // Local state for immediate UI feedback
  const initFormula = step.formula || step.operation || '';
  const [formula, setFormula] = useState(initFormula);
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
        op.id.toUpperCase().startsWith(partial) || op.label.toUpperCase().startsWith(partial)
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
    // Stamp the operation's default orchestration type as the modifier so it's
    // immediately visible and editable in the formula bar.
    // e.g. "source" → =fetch_videos.source(   "map" → =yt_extract_metadata.map(
    const modifier = op.type ? `.${op.type}` : '';
    const newFormula = `=${op.id}${modifier}(`;
    setFormula(newFormula);
    setShowSuggestions(false);
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

      <div className="toolbar" data-testid="step-toolbar" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>

        {/* Summary Button (Levels Icon) — toggles the step overview panel */}
        <button
          className={`btn-icon tab-icon ${isOpen('overview') ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onTogglePanel('overview'); }}
          title="Step Overview"
          style={{
            position: 'relative',
            color: isOpen('overview') ? '#f39c12' : '#95a5a6',
            background: isOpen('overview') ? '#fef9e7' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10"></line>
                <line x1="12" y1="20" x2="12" y2="4"></line>
                <line x1="6" y1="20" x2="6" y2="14"></line>
            </svg>
            {isOpen('overview') && (
                <div style={{
                    position: 'absolute',
                    bottom: '-4px',
                    left: 0,
                    right: 0,
                    height: '2px',
                    background: '#f39c12',
                    zIndex: 10
                }}/>
            )}
        </button>

        {/* Data Button (Database Icon) */}
        <button
          className={`btn-icon tab-icon ${isOpen('data') ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onTogglePanel('data'); }}
          title="Data View"
          style={{
            position: 'relative',
            color: isOpen('data') ? '#9b59b6' : '#95a5a6',
            background: isOpen('data') ? '#f4ecf7' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
            </svg>
            {isOpen('data') && (
                <div style={{
                    position: 'absolute',
                    bottom: '-4px', 
                    left: 0, 
                    right: 0,
                    height: '2px',
                    background: '#9b59b6',
                    zIndex: 10
                }}/>
            )}
        </button>



         {/* Settings Button (Gear Icon) - Activated Settings */}
         <button
          className={`btn-icon tab-icon ${isOpen('settings') ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onTogglePanel('settings'); }}
          title="Miscellaneous Settings"
          style={{
            position: 'relative',
            color: isOpen('settings') ? '#7f8c8d' : '#95a5a6',
            background: isOpen('settings') ? '#f0f3f4' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            {isOpen('settings') && (
                <div style={{
                    position: 'absolute',
                    bottom: '-4px', // Connect to content below
                    left: 0, 
                    right: 0,
                    height: '2px',
                    background: '#7f8c8d',
                    zIndex: 10
                }}/>
            )}
        </button>



        <div style={{ flex: 1 }} />
        {/* Lock Button */}
        <button 
          className="btn-icon" 
          onClick={(e) => { e.stopPropagation(); onLock?.(step.id); }}
          title={isLocked ? "Unlock Step" : "Lock Step"}
          style={{ 
              color: isLocked ? '#f39c12' : '#ccc', 
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginRight: 4
          }}
        >
          {isLocked ? (
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
               <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
               <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
             </svg>
          ) : (
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
             </svg>
          )}
        </button>

        {/* Delete Action - Always visible but behaves differently based on lock state */}
        <button 
            className="btn-icon danger" 
            onClick={(e) => { 
                e.stopPropagation(); 
                if (isLocked) {
                    alert("This operation is locked. Please unlock it to delete.");
                } else {
                    onDelete?.(step.id); 
                }
            }}
            title={isLocked ? "Operation is locked" : "Delete Step"}
            data-testid="btn-delete"
            style={{ 
                color: '#e74c3c', 
                opacity: isLocked ? 0.3 : 1, 
                cursor: isLocked ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center' 
            }}
        >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
        </button>
      </div>

      {/* Formula Bar Section - Now on Top */}
      <div
        className="formula-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          position: 'relative',
          background: '#1e1e1e',
          border: '1px solid #2d2d2d',
          borderRadius: 4,
          padding: '4px 6px',
        }}
      >
        
        {/* Run/Stop Button - Moved Next to Formula Bar */}
        <button 
          className="btn-icon" 
          onClick={(e) => { e.stopPropagation(); onRun?.(step.id); }} 
          title={step.status === 'running' ? 'Stop' : 'Run'}
          data-testid="btn-run"
          style={{ 
            color: step.status === 'running' ? '#e74c3c' : '#2ecc71',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 4
          }}
        >
          {step.status === 'running' ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          )}
        </button>

        {/* Function Button (Fx Icon) - Activated Details */}
        <button
          className={`btn-icon tab-icon ${isOpen('details') ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onTogglePanel('details'); }}
          title="Operation Functionality"
          style={{
            color: isOpen('details') ? '#4ea1ff' : '#aaa',
            background: isOpen('details') ? '#1f3a5f' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 'bold', fontFamily: 'serif', fontStyle: 'italic', fontSize: '12px',
          }}
        >
          fx
        </button>

        {/* Formula Input + Autocomplete Dropdown */}
        <div style={{ flex: 1, position: 'relative' }}>
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
                activateWiring(step.id, stepIndex, inputRef as React.RefObject<HTMLTextAreaElement>);
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
              💡 <strong>Step references go inside an operation's argument.</strong>
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
              ✓ Pass-through — hit ▶ to load this data into the step
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
                        .{op.type}
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

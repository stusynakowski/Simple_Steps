import { useEffect, useId, useRef, useState, type ComponentType } from 'react';
import {
  fetchLoadedResources, fetchResourceTypes, getModifiers,
  type LoadedResourceInfo, type ModifierInfo, type OperationDefinition,
  type ResourceDeclaration, type ResourceTypeInfo,
} from '../services/api';
import type { Step } from '../types/models';
import {
  formatFormula, inferVerb, parseFormula,
  type FormulaParts, type ParsedFormula,
} from '../utils/formulaParser';
import {
  AUTO, autoForWiring, explicitModifiers, fromFieldText, isShapeVerb, moveModifier, partsForTool,
  toFieldText, wiringChanged, withChosenVerb, withEntry,
} from '../utils/formulaParts';
import { effectiveSettings, pyLiteral } from '../utils/resources';
import './ToolEditor.css';
import SymbolIcon from './SymbolIcon';

/**
 * The step's formula as a form, inside the Formula widget:
 *
 *   TOOL: [scale ▾]                       one thin bar
 *   ▾ INPUTS                              what the tool is given
 *   ▾ MODIFIERS  map · auto               how it is applied, in formula order
 *
 * The formula is the only state. The editor shows *formula* (the last one
 * committed — Enter in the formula bar, or the editor's own write) and every
 * edit is written back through the backend, which refuses anything that
 * wouldn't compile. A formula that doesn't parse keeps the editor on the last
 * good one and says why; an edit that isn't a valid step yet stays in the
 * editor, with the reason, until it is.
 *
 * Passing a reference with no verb chosen writes `mod.auto()`: the verb is
 * picked from the input's data each run (core's mod.auto), and the editor shows
 * what it resolves to now and why. Changing the modifiers makes them
 * explicit — auto becomes that verb — and a verb you chose is never replaced.
 */

/** What `auto` resolves to right now: core's verb, why, and whether it read the input's data. */
interface Resolved { kind: string; why: string; usedData: boolean }

/** `over` is the input itself, written in the call, never as a setting. */
const HIDDEN_SETTINGS = new Set(['over']);

/** What a tool's input UI is given. A tool may bring its own one day; this is the contract. */
export interface InputUiProps {
  parts: FormulaParts;
  op: OperationDefinition | undefined;
  previousSteps: Step[];
  resources: Record<string, ResourceDeclaration>;
  onWrite: (next: FormulaParts) => void;
  onDefineResource?: (name: string, definition: string) => Promise<void>;
}

/** Tools that registered their own input UI, by tool id. Empty until tools can provide one. */
const INPUT_UIS: Record<string, ComponentType<InputUiProps>> = {};

interface Props {
  formula: string;
  availableOperations: OperationDefinition[];
  /** The steps before this one: what an argument can reference. */
  previousSteps: Step[];
  /** The workflow's resources: what a resource argument can be. */
  resources?: Record<string, ResourceDeclaration>;
  onDefineResource?: (name: string, definition: string) => Promise<void>;
  /** The editor wrote a new formula. */
  onChange: (formula: string, parsed: ParsedFormula) => void;
}

export default function ToolEditor({
  formula, availableOperations, previousSteps, resources = {}, onDefineResource, onChange,
}: Props) {
  const [parts, setParts] = useState<FormulaParts | null>(null);
  /** The committed formula is valid but isn't a tool call (a literal, a legacy formula). */
  const [notATool, setNotATool] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  /** The formula doesn't parse: only the tool picker works, and it starts the
   *  formula over (dev_plan/126 D4). Everything else waits for the formula bar. */
  const [frozen, setFrozen] = useState(false);
  const [catalog, setCatalog] = useState<Record<string, ModifierInfo>>({});
  /** What `auto` (or a bracket-less formula) resolved to, and for which tool and wiring. */
  const [answer, setAnswer] = useState<{ key: string; resolved: Resolved } | null>(null);

  useEffect(() => { getModifiers().then(setCatalog).catch(() => setCatalog({})); }, []);
  const isShape = (kind: string) => isShapeVerb(kind, catalog);
  const refOf = (stepName: string | null) =>
    previousSteps.find((s) => s.label === stepName)?.outputRefId;

  // Redraw from the formula. One that doesn't parse freezes the panel.
  useEffect(() => {
    let cancelled = false;
    const empty = !formula.trim();
    (empty ? Promise.resolve(null) : parseFormula(formula)).then((p) => {
      if (cancelled) return;
      if (!p) { setParts(null); setNotATool(false); setWarning(null); setFrozen(false); return; }
      if (!p.isValid) { setWarning(p.error ?? 'This formula has a syntax error.'); setFrozen(true); return; }
      setWarning(null);
      setFrozen(false);
      setParts(p.parts ?? null);
      setNotATool(!p.parts);
    }).catch(() => { if (!cancelled) setWarning('Could not reach the server to check this formula.'); });
    return () => { cancelled = true; };
  }, [formula]);

  // auto, or no brackets: ask core which verb that is right now. With the
  // input's data when it has run, so it matches what the run will pick.
  const inferring = !!parts && !parts.inputs.length
    && (parts.modifiers === null || parts.modifiers.some((m) => m.kind === AUTO));
  const inputRef = parts ? refOf(parts.input) : undefined;
  const previewKey = inferring ? JSON.stringify([parts!.tool, parts!.bound_to, parts!.input, parts!.arguments, inputRef]) : '';
  useEffect(() => {
    let cancelled = false;
    (inferring ? inferVerb(parts!, inputRef ?? undefined, resources) : Promise.resolve(null))
      .then((r) => {
        if (!cancelled) setAnswer(r ? { key: previewKey, resolved: { kind: r.verb, why: r.why, usedData: r.used_data } } : null);
      })
      .catch(() => { if (!cancelled) setAnswer(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- previewKey is the dependency
  }, [previewKey]);
  // Only an answer for this tool and wiring: right after a switch, the last
  // tool's verb would be wrong (REQ-FORM-005).
  const resolved = answer && answer.key === previewKey ? answer.resolved : null;

  // Edits arrive faster than the server answers; only the latest one counts.
  const writeSeq = useRef(0);
  // Every change here re-enters the whole formula. While frozen, only choosing
  // a tool does (`restart`), replacing the text that doesn't parse.
  const write = async (requested: FormulaParts, restart = false) => {
    if (frozen && !restart) return;
    const seq = ++writeSeq.current;
    // A wiring change on an undecided step: auto (or source, if it reads nothing).
    const next = !requested.inputs.length && wiringChanged(parts, requested)
      ? { ...requested, modifiers: autoForWiring(requested, isShape) }
      : requested;
    try {
      const res = await formatFormula(next);
      if (seq !== writeSeq.current) return;
      setParts(res.parsed.parts ?? next);
      setWarning(null);
      // The app writes formulas with a leading '=' (docs/dev_plan/104).
      onChange(res.formula.startsWith('=') ? res.formula : `=${res.formula}`, res.parsed);
    } catch (e) {
      if (seq !== writeSeq.current) return;
      setParts(next);
      setWarning(`${e instanceof Error ? e.message : String(e)} — not in the formula yet.`);
    }
  };

  // Core's verbs (map, select, …) and the legacy orchestrators are modifiers,
  // not tools: they live under Modifiers, not in the tool list.
  const tools = availableOperations.filter((o) => o.type !== 'verb' && o.type !== 'orchestrator');
  const op = parts ? tools.find((o) => o.id === parts.tool) : undefined;
  const previous = previousSteps.length ? previousSteps[previousSteps.length - 1].label : null;
  const isCombine = !!parts && parts.inputs.length > 0;
  const InputUi = (parts && INPUT_UIS[parts.tool]) || DefaultInputUi;

  const chooseTool = (id: string) => {
    if (!id) return;
    const chosen = tools.find((o) => o.id === id);
    // Frozen, the last parts are stale: start from the tool alone.
    void write(partsForTool(id, chosen?.type, frozen ? previous : parts?.input ?? previous), frozen);
  };

  return (
    <div className="tool-editor" onClick={(e) => e.stopPropagation()}>
      <div className="te-bar te-tool-bar">
        <span className="te-bar-label">Tool:</span>
        <select
          className="te-tool-select"
          value={frozen ? '' : parts?.tool ?? ''}
          onChange={(e) => chooseTool(e.target.value)}
          disabled={isCombine && !frozen}
          title={op?.description}
        >
          <option value="">Choose a tool…</option>
          {parts && !op && <option value={parts.tool}>{parts.tool}</option>}
          {groupByCategory(tools).map(([category, ops]) => (
            <optgroup key={category} label={category}>
              {ops.map((o) => <option key={o.id} value={o.id}>{o.label || o.id}</option>)}
            </optgroup>
          ))}
        </select>
        {parts?.bound_to && <span className="te-bar-note">on res["{parts.bound_to}"]</span>}
      </div>

      {warning && (
        <div className="te-warning" role="status" title={warning}>
          <SymbolIcon name="warning" size={13} /> {warning}
          {frozen && <div className="te-frozen-note">Fix it in the formula bar, or choose a tool to start the formula over.</div>}
        </div>
      )}

      {notATool && !frozen && (
        <div className="te-panel te-note">This step is a value or a reference, not a tool call. Edit it in the formula bar, or choose a tool to replace it.</div>
      )}

      {parts && isCombine && !frozen && (
        <div className="te-panel te-note">
          A <code>{parts.tool}</code> of {parts.inputs.map((n) => `wf["${n}"]`).join(', ')}. Edit it in the formula bar.
        </div>
      )}

      {parts && !isCombine && (
        <fieldset className="te-fieldset" disabled={frozen} aria-disabled={frozen}
          style={frozen ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
          <Bar title="Inputs" defaultOpen>
            <InputUi parts={parts} op={op} previousSteps={previousSteps} resources={resources}
              onWrite={write} onDefineResource={onDefineResource} />
          </Bar>

          <Bar title="Modifiers" summary={modifiersSummary(parts, resolved)} defaultOpen>
            <ModifierList parts={parts} catalog={catalog} resolved={resolved}
              onWrite={write} />
          </Bar>
        </fieldset>
      )}
    </div>
  );
}

// ── Inputs: the default input UI ─────────────────────────────────────────────

function DefaultInputUi({ parts, op, previousSteps, resources, onWrite, onDefineResource }: InputUiProps) {
  const listId = useId();
  const stepOptions = previousSteps.map((s) => ({ value: `wf["${s.label}"]`, label: `step · ${s.label}` }));
  const resourceOptions = Object.keys(resources).map((n) => ({ value: `res["${n}"]`, label: `resource · ${resources[n].type}` }));

  // Every declared parameter shows, resource ones included: those take res["…"].
  const declared = op?.params ?? [];
  const extra = Object.keys(parts.arguments).filter((n) => !declared.some((p) => p.name === n));
  // An unannotated parameter reports as "string"; its default says what it holds.
  const typeOf = (p: { type?: string; default?: unknown }) =>
    typeof p.default === 'number' ? 'number'
      : typeof p.default === 'boolean' ? 'bool'
        : Array.isArray(p.default) ? 'list' : p.type;
  const setArg = (name: string, text: string, type?: string) =>
    onWrite({ ...parts, arguments: withEntry(parts.arguments, name, fromFieldText(text, type)) });

  const setInput = (text: string) => {
    const v = fromFieldText(text);
    if (v === undefined) return onWrite({ ...parts, input: null });
    if (typeof v === 'object' && v !== null && '$ref' in v) return onWrite({ ...parts, input: (v as { $ref: string }).$ref });
    // Core reads one step positionally; send it anyway so its message explains.
    onWrite({ ...parts, input: text });
  };

  return (
    <div className="te-rows">
      <datalist id={`${listId}-steps`}>
        {stepOptions.map((o) => <option key={o.value} value={o.value} label={o.label} />)}
      </datalist>
      <datalist id={`${listId}-all`}>
        {[...stepOptions, ...resourceOptions].map((o) => <option key={o.value} value={o.value} label={o.label} />)}
      </datalist>

      <ArgRow
        name="input"
        hint="The step this one reads"
        value={parts.input ? `wf["${parts.input}"]` : ''}
        placeholder={previousSteps.length ? 'a previous step, e.g. ' + stepOptions[stepOptions.length - 1].value : 'none: a source'}
        listId={`${listId}-steps`}
        previousSteps={previousSteps}
        onCommit={setInput}
      />
      {parts.resources.map((name, i) => (
        <ArgRow
          key={`res-${i}`}
          name={`resource ${i + 1}`}
          value={`res["${name}"]`}
          listId={`${listId}-all`}
          previousSteps={previousSteps}
          resources={resources}
          onDefineResource={onDefineResource}
          onCommit={(text) => {
            const v = fromFieldText(text);
            const next = [...parts.resources];
            if (v && typeof v === 'object' && '$res' in v) next[i] = (v as { $res: string }).$res;
            else next.splice(i, 1);
            onWrite({ ...parts, resources: next });
          }}
        />
      ))}

      {declared.map((p) => (
        <ArgRow
          key={p.name}
          name={p.name}
          required={p.required}
          hint={p.description}
          value={toFieldText(parts.arguments[p.name])}
          placeholder={
            p.default != null ? toFieldText(p.default)
              : p.kind === 'resource' && parts.resources.length ? 'a resource given by position, above'
                : p.required ? 'a column of the input, or a value' : ''
          }
          options={p.options ?? undefined}
          listId={`${listId}-all`}
          previousSteps={previousSteps}
          resources={resources}
          onDefineResource={onDefineResource}
          onCommit={(text) => setArg(p.name, text, typeOf(p))}
        />
      ))}
      {extra.map((name) => (
        <ArgRow key={name} name={name} value={toFieldText(parts.arguments[name])}
          hint="Passed by the formula; the tool doesn't declare it."
          listId={`${listId}-all`} previousSteps={previousSteps} resources={resources}
          onDefineResource={onDefineResource}
          onCommit={(text) => setArg(name, text)} />
      ))}
    </div>
  );
}

/**
 * One argument: a text box that suggests previous steps (and resources), and
 * takes any literal. A step reference shows what it reads; a resource opens
 * to its settings — the same literals as the Resources menu.
 */
function ArgRow({
  name, value, placeholder, hint, required, options, listId, previousSteps, resources, onDefineResource, onCommit,
}: {
  name: string;
  value: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  options?: (string | number | boolean)[];
  listId: string;
  previousSteps: Step[];
  resources?: Record<string, ResourceDeclaration>;
  onDefineResource?: (name: string, definition: string) => Promise<void>;
  onCommit: (text: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const commit = () => { if (draft !== value) onCommit(draft); };

  const ref = fromFieldText(value);
  const stepName = ref && typeof ref === 'object' && '$ref' in ref ? (ref as { $ref: string }).$ref : null;
  const resName = ref && typeof ref === 'object' && '$res' in ref ? (ref as { $res: string }).$res : null;
  const step = stepName ? previousSteps.find((s) => s.label === stepName) : undefined;

  return (
    <div className="te-arg">
      <label className="te-arg-row" title={hint}>
        <span className="te-arg-name">{name}{required && <span className="te-required">*</span>}</span>
        {options && options.length > 0 ? (
          <select value={value} onChange={(e) => onCommit(e.target.value)}>
            <option value="">{placeholder || '— default —'}</option>
            {options.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
          </select>
        ) : (
          <input
            className={stepName ? 'te-is-step' : resName ? 'te-is-resource' : ''}
            list={listId}
            value={draft}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setDraft(value); }}
          />
        )}
      </label>
      {stepName && (
        <div className="te-arg-detail">
          {step
            ? <>↳ step <b>{stepName}</b>{step.outputColumns?.length ? ` · ${step.outputColumns.length} columns: ${step.outputColumns.slice(0, 4).join(', ')}${step.outputColumns.length > 4 ? '…' : ''}` : ' · not run yet'}</>
            : <>↳ no earlier step named <b>{stepName}</b></>}
        </div>
      )}
      {resName && (
        <ResourceArg name={resName} decl={resources?.[resName]} onDefine={onDefineResource} />
      )}
    </div>
  );
}

/** A resource argument's settings, edited as the Resources menu edits them. */
function ResourceArg({ name, decl, onDefine }: {
  name: string;
  decl: ResourceDeclaration | undefined;
  onDefine?: (name: string, definition: string) => Promise<void>;
}) {
  const [types, setTypes] = useState<Record<string, ResourceTypeInfo>>({});
  const [loaded, setLoaded] = useState<Record<string, LoadedResourceInfo>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchResourceTypes().then(setTypes).catch(() => setTypes({}));
    fetchLoadedResources().then(setLoaded).catch(() => setLoaded({}));
  }, []);

  if (!decl) {
    return <div className="te-arg-detail te-bad">↳ res["{name}"] isn't one of this workflow's resources. Add it from Resources in the toolbar.</div>;
  }
  const info = types[decl.type];
  const current = effectiveSettings(decl, loaded[name]);
  const locked = new Set(loaded[name]?.locked ?? []);
  const settings = info?.settings ?? Object.keys(current).map((k) => ({ name: k, type: '', required: false }));

  const save = async (key: string, text: string, type: string) => {
    const next = withEntry(current, key, fromFieldText(text, type));
    const definition = `${decl.type}(${Object.entries(next).map(([k, v]) => `${k}=${pyLiteral(v)}`).join(', ')})`;
    try { setError(null); await onDefine?.(name, definition); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <Bar title={`res["${name}"]`} summary={`${decl.type}${decl.source === 'loaded' ? ' · ready-made' : ''}`} nested>
      <div className="te-note">Shared by every step that uses it.</div>
      {settings.map((s) => (
        <Field
          key={s.name}
          name={s.name}
          required={s.required}
          value={toFieldText(current[s.name])}
          placeholder={'default' in s && s.default != null ? toFieldText(s.default) : ''}
          disabled={locked.has(s.name) || !onDefine}
          description={locked.has(s.name) ? 'Set by the deployment' : undefined}
          onCommit={(text) => void save(s.name, text, s.type)}
        />
      ))}
      {error && <div className="te-bad">{error}</div>}
    </Bar>
  );
}

// ── Modifiers ────────────────────────────────────────────────────────────────

function ModifierList({ parts, catalog, resolved, onWrite }: {
  parts: FormulaParts;
  catalog: Record<string, ModifierInfo>;
  resolved: Resolved | null;
  onWrite: (p: FormulaParts) => void;
}) {
  const mods = parts.modifiers ?? [];
  const setMods = (next: typeof mods) => onWrite({ ...parts, modifiers: next.length ? next : null });
  // Any change to the modifiers makes them explicit: auto becomes its verb,
  // once core has said which (REQ-FORM-005).
  const explicit = (list: typeof mods) => explicitModifiers(list, resolved?.kind ?? null);

  const add = (kind: string) => {
    if (!kind) return;
    if (isShapeVerb(kind, catalog)) {
      // One shape verb per step: the one chosen replaces it (REQ-FORM-003),
      // and brings its own tool if it applies none (REQ-FORM-004).
      onWrite(withChosenVerb(parts, kind, catalog));
      return;
    }
    // Brackets need a shape verb: retry/timeout on a bare step writes down
    // the verb core would pick, or auto until it has said.
    setMods([...explicit(parts.modifiers ?? [{ kind: AUTO, params: {} }]), { kind, params: {} }]);
  };

  return (
    <div className="te-modifiers">
      {parts.modifiers === null && (
        <div className="te-note">
          None written. Core will infer {resolved ? <><code>{resolved.kind}</code>: {resolved.why}</> : 'the verb when it runs'}.
        </div>
      )}
      {mods.map((m, i) => {
        const info = catalog[m.kind];
        const settings = (info?.settings ?? []).filter((s) => !HIDDEN_SETTINGS.has(s.name));
        const isAuto = m.kind === AUTO;
        return (
          <Bar
            key={`${i}-${m.kind}`}
            title={`${i + 1}. ${m.kind}`}
            summary={isAuto ? (resolved ? `→ ${resolved.kind}` : 'from the data') : info?.class}
            badge={isAuto ? resolved?.why : undefined}
            nested
            defaultOpen
            actions={
              <>
                <button className="te-icon-btn" title="Move up (earlier in the formula)" disabled={i === 0}
                  onClick={() => setMods(explicit(moveModifier(mods, i, -1)))}>↑</button>
                <button className="te-icon-btn" title="Move down (later in the formula)" disabled={i === mods.length - 1}
                  onClick={() => setMods(explicit(moveModifier(mods, i, 1)))}>↓</button>
                <button className="te-icon-btn te-remove" title="Remove this modifier"
                  onClick={() => {
                    const rest = mods.filter((_, j) => j !== i);
                    setMods(isAuto ? rest : explicit(rest));
                  }}>×</button>
              </>
            }
          >
            {isAuto && (
              <div className="te-note">
                {resolved
                  ? <>Picked each run from {resolved.usedData ? <>the data of <b>{parts.input}</b></> : <>the tool's signature (run <b>{parts.input}</b> to use its data)</>}: now <code>{resolved.kind}</code> — {resolved.why}.</>
                  : <>Picked each run from the input's data.</>}
                {' '}Choose a verb to fix it.
              </div>
            )}
            {!isAuto && settings.length === 0 && <div className="te-note">No settings.</div>}
            {settings.map((s) => (
              <Field
                key={s.name}
                name={s.name}
                required={s.required}
                description={s.description ?? (s.type ? `type: ${s.type}` : undefined)}
                value={toFieldText(m.params[s.name])}
                placeholder={s.default != null ? toFieldText(s.default) : s.required ? 'required' : ''}
                onCommit={(text) => setMods(explicit(mods.map((x, j) => j === i
                  ? { ...x, params: withEntry(x.params, s.name, fromFieldText(text, s.type)) } : x)))}
              />
            ))}
          </Bar>
        );
      })}
      <select className="te-add" value="" onChange={(e) => add(e.target.value)} title="Add a modifier at the end of the brackets">
        <option value="">+ Add modifier…</option>
        {(['shape', 'execution', 'naming'] as const).map((cls) => (
          <optgroup key={cls} label={{ shape: 'Shape', execution: 'Execution', naming: 'Naming' }[cls]}>
            {Object.values(catalog).filter((c) => c.class === cls).map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

// ── Building blocks ──────────────────────────────────────────────────────────

/** A thin expander bar, styled like the step's own widget bars. */
function Bar({ title, summary, badge, defaultOpen = false, nested = false, actions, children }: {
  title: string;
  summary?: string;
  badge?: string;
  defaultOpen?: boolean;
  nested?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`te-section ${nested ? 'te-nested' : ''}`}>
      <div className="te-bar">
        <button className="te-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open} title={badge}>
          <span className="te-chevron">{open ? '▾' : '▸'}</span>
          <span className="te-bar-label">{title}</span>
          {summary && <span className={`te-summary ${/^(auto|→)/.test(summary) ? 'te-auto' : ''}`}>{summary}</span>}
        </button>
        {actions && <span className="te-actions">{actions}</span>}
      </div>
      {open && <div className="te-panel">{children}</div>}
    </section>
  );
}

/** A text field that writes on Enter or blur, not on every keystroke. */
function Field({ name, value, placeholder, description, required, disabled, onCommit }: {
  name: string;
  value: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
  disabled?: boolean;
  onCommit: (text: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const commit = () => { if (draft !== value) onCommit(draft); };
  return (
    <label className="te-arg-row" title={description}>
      <span className="te-arg-name">{name}{required && <span className="te-required">*</span>}</span>
      <input
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setDraft(value); }}
      />
    </label>
  );
}

function groupByCategory(ops: OperationDefinition[]): [string, OperationDefinition[]][] {
  const groups = new Map<string, OperationDefinition[]>();
  for (const o of ops) {
    const c = o.category || 'Other';
    groups.set(c, [...(groups.get(c) ?? []), o]);
  }
  return [...groups.entries()];
}

function modifiersSummary(parts: FormulaParts, resolved: Resolved | null): string {
  if (parts.modifiers === null) return resolved ? `${resolved.kind} · inferred` : 'inferred';
  return parts.modifiers.map((m) => (m.kind === AUTO ? `auto${resolved ? ` → ${resolved.kind}` : ''}` : m.kind)).join(', ') || 'none';
}

import { useEffect, useId, useRef, useState, type ComponentType } from 'react';
import {
  fetchLoadedResources, fetchResourceTypes, getModifiers,
  type LoadedResourceInfo, type ModifierInfo, type OperationDefinition,
  type ResourceDeclaration, type ResourceTypeInfo,
} from '../services/api';
import type { Step } from '../types/models';
import {
  formatFormula, inferVerb, parseFormula,
  type FormulaParts, type FormulaReference, type FormulaSpans, type ParsedFormula,
} from '../utils/formulaParser';
import { ExplodedFormula, MapLines, laneBand, mapParts } from './FormulaMap';
import {
  AUTO, autoForWiring, explicitModifiers, fromFieldText, isShapeVerb, moveModifier, partsForTool,
  toFieldText, wiringChanged, withChosenVerb, withEntry,
} from '../utils/formulaParts';
import { effectiveSettings, pyLiteral } from '../utils/resources';
import './ToolEditor.css';
import SymbolIcon from './SymbolIcon';

/**
 * The step's formula as a form, inside the Formula widget, in two columns.
 * Every part is always open — headings, not expanders:
 *
 *   TOOL                           │ INPUT     the data it reads
 *   [scale ▾]                      │   input   wf["a"]
 *   MODIFIERS  map                 │ ARGUMENTS
 *   ┌ 1. map           ↑ ↓ × ┐     │   factor  2
 *
 * A narrow step stacks them (left column first). Each part carries
 * `data-formula-part` (tool / modifiers / input / arguments) so it can later
 * be matched to the piece of the expression it edits.
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
  /** The formula's references (what each picked argument covers), from the parser. */
  refs?: FormulaReference[];
  /** The verb the tool runs under (written, or what auto resolves to): how an argument is read. */
  verb?: string | null;
  /** The step is a plain copy: only what it runs over applies. */
  copy?: boolean;
  /** Marks a field as the editor of one part of the formula (the map's lines end there). */
  hotProps?: HotProps;
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
  /** Core's problems with the step, from the workflow's check when it was entered. */
  problems?: string[];
}

export default function ToolEditor({
  formula, availableOperations, previousSteps, resources = {}, onDefineResource, onChange, problems,
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
  /** The formula the map shows, with its parts' places and its references: always one formula's. */
  const [shown, setShown] = useState<{ formula: string; spans?: FormulaSpans; refs: FormulaReference[] }>({ formula: '', refs: [] });
  /** A literal step's text (`7`, `[1, 2]`): a value, no tool. */
  const [literal, setLiteral] = useState<string | null>(null);
  /** The part under the pointer, in the formula or its field. */
  const [hot, setHot] = useState<string | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const split = useSplit();

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
      if (!p) { setParts(null); setNotATool(false); setWarning(null); setFrozen(false); setLiteral(null); setShown({ formula: '', refs: [] }); return; }
      if (!p.isValid) { setWarning(p.error ?? 'This formula has a syntax error.'); setFrozen(true); return; }
      setWarning(null);
      setFrozen(false);
      setParts(p.parts ?? null);
      setNotATool(!p.parts);
      setLiteral(p.operationId === 'literal' ? formula.trim().replace(/^=/, '').trim() : null);
      setShown({ formula, spans: p.spans, refs: p.references ?? [] });
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
      const written = res.formula.startsWith('=') ? res.formula : `=${res.formula}`;
      setShown({ formula: written, spans: res.parsed.spans, refs: res.parsed.references ?? [] });
      onChange(written, res.parsed);
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

  // Frozen, everything but the tool picker waits for the formula bar.
  const frozenProps = {
    className: 'te-fieldset',
    disabled: frozen,
    'aria-disabled': frozen,
    style: frozen ? { opacity: 0.5, pointerEvents: 'none' as const } : undefined,
  };

  // No tool: a value (`=7`) or a plain copy of a step (`=wf["r"]`). A pick
  // with a selection is `identity` with its select, shown as such.
  const isCopy = !!parts && parts.tool === 'identity' && parts.modifiers?.length === 1
    && parts.modifiers[0].kind === 'select' && !Object.keys(parts.modifiers[0].params).length;
  const noTool = literal !== null ? 'value' : isCopy ? 'copy' : null;
  // The verb the arguments are read under: written, or what auto resolves to.
  const written = parts?.modifiers?.find((m) => isShape(m.kind) && m.kind !== AUTO)?.kind;
  const verb = written ?? resolved?.kind ?? null;
  const parts_ = mapParts(shown.spans);
  // A value step: its one field writes the formula, checked by the backend first.
  const writeLiteral = async (text: string) => {
    const next = `=${text.trim()}`;
    const p = await parseFormula(next);
    if (!p.isValid) { setWarning(`${p.error ?? 'not a value'} — not in the formula yet.`); return; }
    setWarning(null);
    onChange(next, p);
  };
  const hotProps = (key: string) => ({
    'data-map-target': key,
    className: hot === key ? 'te-hot' : undefined,
    onMouseEnter: () => setHot(key),
    onMouseLeave: () => setHot(null),
  });

  return (
    <div className={`tool-editor${!frozen && parts_.length ? ' te-mapped' : ''}`} ref={root} onClick={(e) => e.stopPropagation()}>
      {/* A formula core can't read (as you type), else what the workflow's check
          found when the step was entered (core_migration §6 D2). */}
      {(warning || !!problems?.length) && (
        <div className="te-warning" role="status" title={warning ?? problems!.join('\n')}>
          <SymbolIcon name="warning" size={13} /> {warning ?? problems!.join('; ')}
          {frozen && <div className="te-frozen-note">Fix it in the formula bar, or choose a tool to start the formula over.</div>}
        </div>
      )}

      {/* The formula, part by part; a dotted line from each part to its field. */}
      {!frozen && parts_.length > 0 && (
        <ExplodedFormula formula={shown.formula} parts={parts_} hot={hot} onHot={setHot} />
      )}

      <div className="te-columns" style={{
        gridTemplateColumns: `minmax(140px, ${split.fraction}fr) 7px minmax(160px, ${1 - split.fraction}fr)`,
        // Room for the lines' lanes between the formula and the fields.
        paddingTop: !frozen && parts_.length ? laneBand(parts_.length) : undefined,
      }}>
        {/* Left: what is called, and how it is applied. */}
        <div className="te-col te-col-call">
          <Section title="Tool" part="tool" note={parts?.bound_to ? `on res["${parts.bound_to}"]` : undefined}>
            <div {...hotProps('tool')}>
              <select
                className="te-tool-select"
                value={frozen || noTool ? '' : parts?.tool ?? ''}
                onChange={(e) => chooseTool(e.target.value)}
                disabled={isCombine && !frozen}
                title={op?.description}
              >
                <option value="">{noTool === 'value' ? 'No tool: a value' : noTool === 'copy' ? 'No tool: a copy of a step' : 'Choose a tool…'}</option>
                {parts && !op && !noTool && <option value={parts.tool}>{parts.tool}</option>}
                {groupByCategory(tools).map(([category, ops]) => (
                  <optgroup key={category} label={category}>
                    {ops.map((o) => <option key={o.id} value={o.id}>{o.label || o.id}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            {noTool === 'value' && <div className="te-note te-tool-desc">A value is its own source: no tool runs, and the step is this one value. Choose a tool to compute it instead.</div>}
            {noTool === 'copy' && <div className="te-note te-tool-desc">No tool runs: the step is a copy of the step it reads. Select rows or columns in that step's grid to take part of it, or choose a tool.</div>}
            {!noTool && op?.description && <div className="te-note te-tool-desc">{op.description}</div>}
          </Section>

          {parts && !isCombine && !noTool && (
            <fieldset {...frozenProps}>
              <Section title="Modifiers" part="modifiers" summary={modifiersSummary(parts, resolved)}>
                <ModifierList parts={parts} catalog={catalog} resolved={resolved}
                  onWrite={write} hotProps={hotProps} />
              </Section>
            </fieldset>
          )}
        </div>

        <div
          className="te-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Drag to give the tool or the arguments more room"
          title="Drag to resize; double-click to reset"
          onPointerDown={(e) => split.start(e, root.current?.querySelector('.te-columns') ?? null)}
          onDoubleClick={split.reset}
        />

        {/* Right: what the tool is given — the data it runs over and its arguments. */}
        <div className="te-col te-col-args">
          {noTool === 'value' && !frozen && (
            <Section title="Arguments" part="arguments">
              <div {...hotProps('value')}>
                <Field name="value" value={literal ?? ''} description="A number, text in quotes, a list or a dict"
                  onCommit={(text) => { void writeLiteral(text); }} />
              </div>
            </Section>
          )}

          {notATool && literal === null && !frozen && (
            <div className="te-note te-col-note">This step isn't a tool call. Edit it in the formula bar, or choose a tool to replace it.</div>
          )}

          {parts && isCombine && !frozen && (
            <div className="te-note te-col-note">
              A <code>{parts.tool}</code> of {parts.inputs.map((n) => `wf["${n}"]`).join(', ')}. Edit it in the formula bar.
            </div>
          )}

          {parts && !isCombine && (
            <fieldset {...frozenProps}>
              <InputUi parts={parts} op={op} previousSteps={previousSteps} resources={resources}
                onWrite={write} onDefineResource={onDefineResource}
                refs={shown.refs} verb={verb} copy={noTool === 'copy'} hotProps={hotProps} />
            </fieldset>
          )}

          {!parts && !notATool && !frozen && (
            <div className="te-note te-col-note">Choose a tool to see what it takes.</div>
          )}
        </div>
      </div>

      {!frozen && parts_.length > 0 && <MapLines root={root} hot={hot} deps={[shown, split.fraction, parts, literal, resolved]} />}
    </div>
  );
}

/** The split between the tool and the arguments: a fraction of the width, dragged, remembered per browser. */
function useSplit() {
  const KEY = 'simple-steps.formula-panel.split';
  const DEFAULT = 0.4;
  const [fraction, setFraction] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(KEY));
      return v > 0.15 && v < 0.85 ? v : DEFAULT;
    } catch { return DEFAULT; }
  });
  const save = (v: number) => { try { localStorage.setItem(KEY, String(v)); } catch { /* not kept: fine */ } };
  const start = (e: React.PointerEvent, columns: Element | null) => {
    if (!columns) return;
    e.preventDefault();
    const box = columns.getBoundingClientRect();
    let last = fraction;
    const move = (ev: PointerEvent) => {
      last = Math.min(0.8, Math.max(0.2, (ev.clientX - box.left) / box.width));
      setFraction(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      save(last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const reset = () => { setFraction(DEFAULT); save(DEFAULT); };
  return { fraction, start, reset };
}

/** What a field gets to say which part of the formula it edits, and to light up with it. */
type HotProps = (key: string) => {
  'data-map-target': string;
  className?: string;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
};

// ── Inputs: the default input UI ─────────────────────────────────────────────

function DefaultInputUi({
  parts, op, previousSteps, resources, onWrite, onDefineResource, refs = [], verb, copy, hotProps,
}: InputUiProps) {
  const listId = useId();
  const mark = (key: string) => (hotProps ? hotProps(key) : {});
  const inputStep = parts.input ? previousSteps.find((s) => s.label === parts.input) : undefined;
  const inputCols = columnsOf(inputStep);
  const perRow = !verb || PER_ROW.has(verb);
  /**
   * The note under an argument: what the tool receives when it reads a step,
   * else, while it's empty, where its value comes from (a column of the same
   * name, its default, or nowhere yet). An argument may name any column:
   * `weight=wf["r"]["n"]` gives `weight` each row's `n`.
   */
  const argNote = (name: string, isResource: boolean, hasDefault: boolean): string | undefined => {
    const ref = refs.find((r) => r.argument === name);
    if (ref) return receives(ref, verb, columnsOf(previousSteps.find((s) => s.label === ref.step)));
    if (isResource || parts.arguments[name] !== undefined || !parts.input) return undefined;
    if (!perRow) return undefined;
    if (inputCols.includes(name)) return `↳ from column ${name} of ${parts.input}, each row (same name)`;
    if (hasDefault) return undefined;
    return inputCols.length
      ? `↳ ${parts.input} has no column ${name}: give a value, or any column, e.g. ${name}=wf["${parts.input}"]["${inputCols[0]}"]`
      : undefined;
  };
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
    <>
      <datalist id={`${listId}-steps`}>
        {stepOptions.map((o) => <option key={o.value} value={o.value} label={o.label} />)}
      </datalist>
      <datalist id={`${listId}-all`}>
        {[...stepOptions, ...resourceOptions].map((o) => <option key={o.value} value={o.value} label={o.label} />)}
      </datalist>

      <Section title="Arguments" part="arguments">
        {/* What it runs over: the rows it's applied to. A tool's input is not
            just another argument: it sets the rows, and its columns fill the
            parameters you don't set, by name. */}
        <div {...mark('input')}>
          <ArgRow
            name="runs over"
            hint="The step this one runs over: its rows, and its columns by name"
            value={parts.input ? `wf["${parts.input}"]` : ''}
            placeholder={previousSteps.length ? 'a previous step, e.g. ' + stepOptions[stepOptions.length - 1].value : 'nothing: a source'}
            listId={`${listId}-steps`}
            previousSteps={previousSteps}
            onCommit={setInput}
            note={inputStep && !copy ? runsOver(parts.input!, verb, inputCols) : undefined}
          />
        </div>
        {!copy && parts.resources.map((name, i) => (
          <div key={`res-${i}`} {...mark(`res:${i}`)}>
            <ArgRow
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
          </div>
        ))}
        {!copy && !declared.length && !extra.length && <div className="te-note">This tool takes no other arguments.</div>}
        {!copy && declared.map((p) => (
          <div key={p.name} {...mark(`arg:${p.name}`)}>
            <ArgRow
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
              note={argNote(p.name, p.kind === 'resource', p.default != null)}
            />
          </div>
        ))}
        {!copy && extra.map((name) => (
          <div key={name} {...mark(`arg:${name}`)}>
            <ArgRow name={name} value={toFieldText(parts.arguments[name])}
              hint="Passed by the formula; the tool doesn't declare it."
              listId={`${listId}-all`} previousSteps={previousSteps} resources={resources}
              onDefineResource={onDefineResource}
              onCommit={(text) => setArg(name, text)}
              note={argNote(name, false, false)} />
          </div>
        ))}
      </Section>
    </>
  );
}

// ── What an argument passes (core-asks model.md, "What an argument passes") ──

/** Verbs that call the tool once per row: an argument's column gives each call its own row's cell. */
const PER_ROW = new Set(['map', 'filter', 'expand', 'group']);

/** A step's data columns, as core's view or its last run reports them. */
function columnsOf(step: Step | undefined): string[] {
  return step?.viewColumns?.map((c) => c.name) ?? step?.outputColumns ?? [];
}

/** The runs-over row's note: what the input sets, and how the parameters read it. */
function runsOver(step: string, verb: string | null | undefined, cols: string[]): string {
  const how = verb && PER_ROW.has(verb) ? 'one call per row'
    : verb === 'collapse' ? 'all its rows combined into one (or one per group)'
      : verb === 'table' ? 'the whole table in one call'
        : 'its rows';
  const named = cols.length ? ` Its columns (${cols.slice(0, 6).join(', ')}${cols.length > 6 ? ', …' : ''}) fill parameters of the same name that you don't set.` : '';
  return `↳ ${how} of ${step}.${named}`;
}

/** Rows in core's spec, in words. */
function rowsInWords(rows: FormulaReference['rows']): string {
  if (rows === undefined || rows === null) return 'every row';
  if (typeof rows === 'number') return `row ${rows}`;
  if (Array.isArray(rows)) return `rows ${rows.join(', ')}`;
  if (typeof rows === 'object' && 'where' in rows) return 'the rows that match the condition';
  if (typeof rows === 'object') {
    const a = rows.start ?? 0;
    return rows.stop == null ? `rows ${a} to the end` : `rows ${a}–${rows.stop - 1}`;
  }
  return `row ${String(rows)}`;
}

/**
 * What a tool receives for an argument that reads a step: the data, never
 * the `#` column or the column's name. As core passes it (run 2026-11-10):
 * a column pick gives a per-row tool each row's own cell (the steps must
 * line up row for row, or core refuses), and anything else the whole column
 * as a list; one cell is one value; a whole step is the same for every call,
 * its one column as a list or, with several columns, the table.
 */
function receives(ref: FormulaReference, verb: string | null | undefined, cols: string[]): string {
  const step = ref.step;
  const names = ref.columns && 'names' in ref.columns ? ref.columns.names : null;
  const oneRow = typeof ref.rows === 'number';
  if (!ref.columns && ref.rows === undefined) {
    if (cols.length === 1) {
      return `↳ all of column ${cols[0]} of ${step}, as one list, the same for every call. For each row's own value, pick the column: wf["${step}"]["${cols[0]}"]`;
    }
    return `↳ the whole table ${step}${cols.length ? ` (${cols.slice(0, 6).join(', ')}${cols.length > 6 ? ', …' : ''})` : ''}, the same for every call: its data only, never the # column`;
  }
  if (names && names.length === 1) {
    const col = names[0];
    if (oneRow) return `↳ one value: ${step}, row ${ref.rows}, column ${col}. The same for every call`;
    if (ref.rows === undefined || ref.rows === null) {
      if (verb && PER_ROW.has(verb)) return `↳ each row's own value from column ${col} of ${step} (the values, not the column's name). ${step} must line up row for row with what this step runs over`;
      return `↳ all of column ${col} of ${step}, as one list of its values`;
    }
    return `↳ column ${col} of ${step}, ${rowsInWords(ref.rows)}, as a list of values`;
  }
  const colWords = names ? `columns ${names.join(', ')}` : 'every data column';
  return `↳ part of ${step}: ${rowsInWords(ref.rows)}, ${colWords}, as a table`;
}

/**
 * One argument: a text box that suggests previous steps (and resources), and
 * takes any literal. A step reference shows what it reads; a resource shows
 * its settings beneath it — the same literals as the Resources menu.
 */
function ArgRow({
  name, value, placeholder, hint, required, options, listId, previousSteps, resources, onDefineResource, onCommit, note,
}: {
  /** What this argument passes the tool, or where its value comes from, in words. */
  note?: string;
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
      {note ? <div className="te-arg-detail te-arg-receives">{note}</div> : stepName && (
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
    <div className="te-res">
      <div className="te-res-head">
        <code>res["{name}"]</code>
        <span>{decl.type}{decl.source === 'loaded' ? ' · ready-made' : ''} · shared by every step that uses it</span>
      </div>
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
    </div>
  );
}

// ── Modifiers ────────────────────────────────────────────────────────────────

function ModifierList({ parts, catalog, resolved, onWrite, hotProps }: {
  parts: FormulaParts;
  catalog: Record<string, ModifierInfo>;
  resolved: Resolved | null;
  onWrite: (p: FormulaParts) => void;
  hotProps?: HotProps;
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
          <div key={`${i}-${m.kind}`} {...(hotProps ? hotProps(`mod:${i}`) : {})}>
          <ModCard
            title={`${i + 1}. ${m.kind}`}
            summary={isAuto ? (resolved ? `→ ${resolved.kind}` : 'from the data') : info?.class}
            badge={isAuto ? resolved?.why : undefined}
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
          </ModCard>
          </div>
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

/**
 * One part of the formula, always open: a small heading over its fields.
 * `part` names the piece of the expression it edits (`data-formula-part`).
 */
function Section({ title, part, summary, note, children }: {
  title: string;
  part: string;
  summary?: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="te-section" data-formula-part={part}>
      <div className="te-heading">
        <span className="te-heading-label">{title}</span>
        {summary && <span className={`te-summary ${/^(auto|→)/.test(summary) ? 'te-auto' : ''}`}>{summary}</span>}
        {note && <span className="te-heading-note">{note}</span>}
      </div>
      <div className="te-section-body">{children}</div>
    </section>
  );
}

/** One modifier: a light card with its name, what it is, and its settings. */
function ModCard({ title, summary, badge, actions, children }: {
  title: string;
  summary?: string;
  badge?: string;
  actions: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="te-mod">
      <div className="te-mod-head" title={badge}>
        <span className="te-mod-title">{title}</span>
        {summary && <span className={`te-summary ${/^(auto|→)/.test(summary) ? 'te-auto' : ''}`}>{summary}</span>}
        <span className="te-actions">{actions}</span>
      </div>
      {children}
    </div>
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

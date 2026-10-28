/**
 * How the step editor shows a formula value in a text field, and reads it
 * back. A field holds what the user would type: plain text for a string,
 * `2` for a number, `True`, `[1, 2]`, or `wf["step"]` / `res["name"]` for a
 * reference — the same spellings as the formula, minus quotes on plain text.
 */
import type { ArgValue, FormulaParts, ModifierPart } from './formulaParser';

const REF = /^(wf|res)\[\s*(["'])(.*)\2\s*\]$/;

const isRef = (v: unknown): v is { $ref: string } =>
  typeof v === 'object' && v !== null && Object.keys(v).length === 1 && '$ref' in v;
const isRes = (v: unknown): v is { $res: string } =>
  typeof v === 'object' && v !== null && Object.keys(v).length === 1 && '$res' in v;

/** A value as its field text. `undefined` (not passed) is an empty field. */
export function toFieldText(v: ArgValue): string {
  if (v === undefined) return '';
  if (isRef(v)) return `wf["${v.$ref}"]`;
  if (isRes(v)) return `res["${v.$res}"]`;
  if (typeof v === 'string') return v;
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (v === null) return 'None';
  return JSON.stringify(v);
}

/**
 * Field text as a value. *type* is the parameter's or setting's declared type
 * (`number`, `int | float`, `bool`, `list | tuple | dict`, …) and decides
 * whether `2` is a number or the text "2". Empty means "not passed".
 */
export function fromFieldText(text: string, type?: string | null): ArgValue | undefined {
  const t = text.trim();
  if (t === '') return undefined;
  const ref = REF.exec(t);
  if (ref) return ref[1] === 'wf' ? { $ref: ref[3] } : { $res: ref[3] };
  const declared = (type ?? '').toLowerCase();
  if (/(number|int|float)/.test(declared) && t !== '' && Number.isFinite(Number(t))) return Number(t);
  if (/bool/.test(declared)) {
    if (/^true$/i.test(t)) return true;
    if (/^false$/i.test(t)) return false;
  }
  if (t === 'None') return null;
  if (/(list|tuple|dict|object)/.test(declared) || !declared) {
    if (/^[[{]/.test(t)) {
      try { return JSON.parse(t.replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null')); }
      catch { /* not JSON: keep it as text, the backend says why */ }
    }
  }
  return text;
}

/** *args* with *name* set to *value*, or removed when *value* is `undefined`. */
export function withEntry<T>(args: Record<string, T>, name: string, value: T | undefined): Record<string, T> {
  const next = { ...args };
  if (value === undefined) delete next[name];
  else next[name] = value;
  return next;
}

/** Move the modifier at *index* by *delta* (−1 up, +1 down), clamped. */
export function moveModifier(mods: ModifierPart[], index: number, delta: number): ModifierPart[] {
  const to = index + delta;
  if (to < 0 || to >= mods.length) return mods;
  const next = [...mods];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/**
 * *mods* with its shape verb set to *verb*: the first shape modifier is
 * replaced (its settings belong to the old verb), or *verb* goes first when
 * there is none. Execution modifiers (retry, timeout) stay where they are.
 */
export function withShapeVerb(
  mods: ModifierPart[] | null,
  verb: string,
  isShape: (kind: string) => boolean,
): ModifierPart[] {
  const list = mods ?? [];
  const i = list.findIndex((m) => isShape(m.kind));
  if (i < 0) return [{ kind: verb, params: {} }, ...list];
  if (list[i].kind === verb) return list;
  const next = [...list];
  next[i] = { kind: verb, params: {} };
  return next;
}

/** `mod.auto()`: core picks the verb from the input's data each run. */
export const AUTO = 'auto';

/**
 * The modifiers after the step's wiring changed. A step that reads a
 * reference and has no verb chosen gets `mod.auto()`; an auto step that no
 * longer reads anything becomes a source. A verb the user chose is kept.
 */
export function autoForWiring(parts: FormulaParts, isShape: (kind: string) => boolean): ModifierPart[] | null {
  const shape = parts.modifiers?.find((m) => isShape(m.kind));
  const undecided = !shape || shape.kind === AUTO;
  if (!undecided) return parts.modifiers;
  if (parts.input) return withShapeVerb(parts.modifiers, AUTO, isShape);
  return shape?.kind === AUTO ? withShapeVerb(parts.modifiers, 'source', isShape) : parts.modifiers;
}

/**
 * Changing the modifiers makes them explicit: `auto` becomes the verb it
 * resolves to now. *resolved* is `null` until core has answered for the
 * step's current tool and wiring; `auto` is then kept, never guessed.
 */
export function explicitModifiers(mods: ModifierPart[], resolved: string | null): ModifierPart[] {
  if (!resolved) return mods;
  return mods.map((m) => (m.kind === AUTO ? { kind: resolved, params: {} } : m));
}

/** What the editor reads from core's catalog entry for a modifier. */
export interface VerbInfo {
  class: 'shape' | 'execution' | 'naming';
  /** `false` for a verb that applies no tool (select, sort, …). */
  takes_tool?: boolean | 'optional' | null;
  /** The tool such a verb runs on (`identity`). */
  default_tool?: string | null;
}

/**
 * Whether *kind* is a shape verb — not an execution modifier (retry, …) or
 * `name`. A kind the catalog doesn't list yet counts as one.
 */
export function isShapeVerb(kind: string, catalog: Record<string, VerbInfo>): boolean {
  return (catalog[kind]?.class ?? 'shape') === 'shape';
}

/**
 * *parts* with the shape verb *verb* chosen. A step has one shape verb, so it
 * replaces the current one (`auto` included); execution modifiers stay. A
 * verb that applies no tool runs on its own tool (core's `default_tool`), so
 * the old tool and its arguments go with it.
 */
export function withChosenVerb(parts: FormulaParts, verb: string, catalog: Record<string, VerbInfo>): FormulaParts {
  const isShape = (kind: string) => isShapeVerb(kind, catalog);
  const modifiers = withShapeVerb(parts.modifiers, verb, isShape);
  const info = catalog[verb];
  if (info?.takes_tool === false && info.default_tool && parts.tool !== info.default_tool) {
    return { ...parts, tool: info.default_tool, bound_to: null, resources: [], arguments: {}, modifiers };
  }
  return { ...parts, modifiers };
}

/** Whether an edit changed what the step reads or how — the cue to re-infer its verb. */
export function wiringChanged(a: FormulaParts | null, b: FormulaParts): boolean {
  if (!a) return true;
  return a.tool !== b.tool || a.bound_to !== b.bound_to || a.input !== b.input
    || JSON.stringify(a.arguments) !== JSON.stringify(b.arguments)
    || JSON.stringify(a.resources) !== JSON.stringify(b.resources);
}

/**
 * Parts for a step that has just been given *tool*: the verb is inferred, and
 * it reads the step before it — unless the tool is a source, which reads none.
 */
export function partsForTool(tool: string, toolType: string | undefined, previousStep: string | null): FormulaParts {
  const isSource = toolType === 'source';
  return {
    tool,
    bound_to: null,
    modifiers: isSource ? [{ kind: 'source', params: {} }] : null,
    input: isSource ? null : previousStep,
    resources: [],
    arguments: {},
    inputs: [],
  };
}

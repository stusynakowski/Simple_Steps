/**
 * The verb a step runs under. Core's shape verbs come from ``GET /api/modifiers``
 * (map, filter, group, expand, collapse, sweep, select, …); 'dataframe' and
 * 'raw_output' are the app's older modes, still accepted by the backend.
 */
export type OrchestrationMode = string;

export interface ParsedFormula {
  operationId: string | null;
  /**
   * The orchestration modifier explicitly present in the formula, e.g. the
   * `.map` part of `=yt_extract_metadata.map(url=step1.url)`.
   * `null` means the formula has no modifier — the operation's registered
   * default `type` will be used at execution time.
   */
  orchestration: OrchestrationMode | null;
  args: Record<string, string>;
  isValid: boolean;
  /** Why the formula is invalid, when it is (`/api/parse_formula`). */
  error?: string;
  /** Set for a formula in core's syntax: the core operation it compiles to. */
  operation?: Record<string, unknown>;
  /** Set for a formula in core's syntax: the formula as the step editor edits it. */
  parts?: FormulaParts;
  rawInput: string;
}

/** A tool argument: a literal, another step's value, or a resource. */
export type ArgValue = unknown | { $ref: string } | { $res: string };

/** One modifier as written, e.g. `mod.map(name="score")`. */
export interface ModifierPart {
  kind: string;
  params: Record<string, unknown>;
}

/**
 * A formula in core's syntax, split the way the step editor shows it
 * (`operation_formula.to_parts`). Modifiers are in written order — left to
 * right in the formula, top to bottom in the editor.
 */
export interface FormulaParts {
  tool: string;
  /** For `res["db"].lookup`: the resource the tool is bound to. */
  bound_to: string | null;
  /** `null` when there are no brackets: the verb is inferred from the tool. */
  modifiers: ModifierPart[] | null;
  /** The step it reads, `wf["…"]`; `null` for a source or sweep. */
  input: string | null;
  /** Resources passed by position, `res["…"]`. */
  resources: string[];
  arguments: Record<string, ArgValue>;
  /** Set for a combine (`join` / `stack` / `zip`): every step it reads. */
  inputs: string[];
}

/**
 * The shape verb core picks for *parts*, and why (`POST /api/infer_verb`).
 * *inputRef* is the input step's output, when it has run — core then reads its
 * columns too. *resources* is the workflow's declarations, for bound tools.
 */
export async function inferVerb(
  parts: FormulaParts,
  inputRef?: string,
  resources?: Record<string, unknown>,
): Promise<{ verb: string; why: string; used_data: boolean }> {
  const resp = await fetch(`${API_BASE}/infer_verb`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ parts, input_ref: inputRef, resources }),
  });
  if (!resp.ok) throw new Error('could not infer a verb');
  return resp.json();
}

/** Write parts as a formula. Throws with the reason if they make no valid step. */
export async function formatFormula(parts: FormulaParts): Promise<{ formula: string; parsed: ParsedFormula }> {
  const resp = await fetch(`${API_BASE}/format_formula`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parts }),
  });
  const body = await resp.json();
  if (!resp.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'invalid step');
  return body;
}



/**
 * Detect whether a value looks like a step reference token.
 *
 * Step references are produced by the wiring UI and follow one of these forms:
 *   stepN.column       — positional alias  (step1.url)
 *   step-abc123.column — step ID           (step-02iqkl5.url)
 *   StepLabel.column   — step label        (Step 0.url)  — rare, label has space
 *
 * This is intentionally conservative: we only treat `word.word` patterns as
 * references, where the first segment starts with "step" (case-insensitive)
 * or matches a step-ID pattern.
 */

// --- Canonical formula parsing/building is now in the backend (Python).
// These stubs call the backend API for all formula operations.
import { API_BASE } from '../services/api';

// No-op: always use backend for formula parsing


/**
 * Split a raw args string on commas, respecting quotes and brackets.
 * e.g. `data=step-000[row=0, col=value], x="a,b"` → two tokens.
 */


/**
 * Parses a formula string like:
 *   `=yt_extract_metadata.map(url="step1.url", min_views=1000)`
 *   `=fetch_videos(channel_url="https://...")`          ← no modifier
 *   `=!.map df["score"] = df["score"].astype(int); result = df`  ← eval mode
 *   `="hello"`  or  `=42`  or  `=[1,2,3]`  or  `={"a":[1,2]}`  ← literals
 * into a structured object.
 */
export async function parseFormula(input: string): Promise<ParsedFormula> {
  const resp = await fetch(`${API_BASE}/parse_formula`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ formula: input }),
  });
  return resp.json();
}


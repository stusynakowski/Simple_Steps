export type OrchestrationMode = 'source' | 'map' | 'filter' | 'dataframe' | 'expand' | 'raw_output';

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
  rawInput: string;
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

export async function isStepReference(value: unknown): Promise<boolean> {
  if (typeof value !== 'string') return false;
  // Use the backend's parser for canonical check
  const resp = await fetch(`${API_BASE}/parse_formula`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ formula: `=${value}` }),
  });
  const parsed = await resp.json();
  return parsed.operationId === 'passthrough';
}

/**
 * Format a config value for inclusion in a formula string.
 *
 * - Step references (e.g. step1.url) are left UNQUOTED so they read like
 *   Python variable attribute access: `=op.map(url=step1.url)`
 * - Numbers and booleans are unquoted.
 * - Everything else is double-quoted.
 */
// No-op: always use backend for formula building
export function formatFormulaValue(_v: unknown): string {
  throw new Error('formatFormulaValue is now handled by the backend. Use buildFormula().');
}

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

/**
 * Builds a formula string from an operation ID, an optional orchestration
 * modifier, and a key→value config map.
 *
 * Examples:
 *   buildFormula('yt_extract_metadata', 'map', { url: 'step1.url' })
 *   → `=yt_extract_metadata.map(url=step1.url)`
 *
 *   buildFormula('fetch_videos', 'source', { channel_url: 'https://...' })
 *   → `=fetch_videos.source(channel_url="https://...")`
 *
 *   buildFormula('fetch_videos', null, { channel_url: 'https://...' })
 *   → `=fetch_videos(channel_url="https://...")`  ← no modifier
 */
export async function buildFormula(
  operationId: string,
  config: Record<string, any>,
  orchestration?: OrchestrationMode | null,
): Promise<string> {
  const resp = await fetch(`${API_BASE}/build_formula`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation_id: operationId, config, orchestration }),
  });
  const data = await resp.json();
  return data.formula;
}

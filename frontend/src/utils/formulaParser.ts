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

const ORCHESTRATION_MODES: ReadonlySet<string> = new Set([
  'source', 'map', 'filter', 'dataframe', 'expand', 'raw_output',
]);

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
export function isStepReference(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  // step<N>.column  OR  step-<id>.column
  return /^step[\w-]*\.\w+$/i.test(value);
}

/**
 * Format a config value for inclusion in a formula string.
 *
 * - Step references (e.g. step1.url) are left UNQUOTED so they read like
 *   Python variable attribute access: `=op.map(url=step1.url)`
 * - Numbers and booleans are unquoted.
 * - Everything else is double-quoted.
 */
export function formatFormulaValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  if (s.startsWith('=')) return s;
  // Step references stay unquoted
  if (isStepReference(s)) return s;
  // Pure numbers typed as strings stay unquoted
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  // Everything else is quoted
  return `"${s}"`;
}

/**
 * Parses a formula string like:
 *   `=yt_extract_metadata.map(url="step1.url", min_views=1000)`
 *   `=fetch_videos(channel_url="https://...")`          ← no modifier
 * into a structured object.
 */
export function parseFormula(input: string): ParsedFormula {
  const raw = (input || '').trim();

  if (!raw.startsWith('=')) {
    return { operationId: null, orchestration: null, args: {}, isValid: false, rawInput: raw };
  }

  const body = raw.slice(1); // Remove leading '='
  const parenIdx = body.indexOf('(');

  if (parenIdx === -1) {
    // Still typing — no '(' yet. May have a partial modifier too.
    const dotIdx = body.indexOf('.');
    const operationId = dotIdx !== -1 ? body.slice(0, dotIdx) : body;
    return {
      operationId: operationId.toUpperCase() || null,
      orchestration: null,
      args: {},
      isValid: false,
      rawInput: raw,
    };
  }

  // Everything before '(' is either "opId" or "opId.modifier"
  const head = body.slice(0, parenIdx);
  const dotIdx = head.indexOf('.');
  let operationId: string;
  let orchestration: OrchestrationMode | null = null;

  if (dotIdx !== -1) {
    operationId = head.slice(0, dotIdx);
    const maybeMode = head.slice(dotIdx + 1);
    orchestration = ORCHESTRATION_MODES.has(maybeMode)
      ? (maybeMode as OrchestrationMode)
      : null;
  } else {
    operationId = head;
  }

  if (!operationId) {
    return { operationId: null, orchestration: null, args: {}, isValid: false, rawInput: raw };
  }

  const hasClosingParen = raw.endsWith(')');
  const argsRaw = hasClosingParen
    ? body.slice(parenIdx + 1, body.length - 1)
    : body.slice(parenIdx + 1);

  const args: Record<string, string> = {};

  if (argsRaw.trim()) {
    // Split on commas that are NOT inside quotes
    const argTokens = argsRaw.split(/,(?=(?:[^"']*["'][^"']*["'])*[^"']*$)/);
    argTokens.forEach(token => {
      const eqIdx = token.indexOf('=');
      if (eqIdx !== -1) {
        const key = token.slice(0, eqIdx).trim();
        let val = token.slice(eqIdx + 1).trim();
        // Strip surrounding quotes
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (key) args[key] = val;
      }
    });
  }

  return {
    operationId,
    orchestration,
    args,
    isValid: hasClosingParen,
    rawInput: raw,
  };
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
export function buildFormula(
  operationId: string,
  config: Record<string, any>,
  orchestration?: OrchestrationMode | null,
): string {
  if (!operationId || operationId === 'noop') return '';
  // Pass-through steps store their bare reference token in _ref
  if (operationId === 'passthrough') {
    return String(config._ref ?? '');
  }

  // The orchestration modifier — use explicit arg, else fall back to
  // _orchestrator stored in config (legacy path), else omit.
  const effectiveMode: OrchestrationMode | null =
    orchestration !== undefined
      ? orchestration
      : (config._orchestrator as OrchestrationMode | null) ?? null;

  const modifier = effectiveMode ? `.${effectiveMode}` : '';

  const args = Object.entries(config)
    .filter(([k]) => !k.startsWith('_')) // all _-prefixed keys are internal
    .map(([k, v]) => {
      const valStr = formatFormulaValue(v);
      return `${k}=${valStr}`;
    })
    .join(', ');

  return `=${operationId}${modifier}(${args})`;
}

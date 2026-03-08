export interface ParsedFormula {
  operationId: string | null;
  args: Record<string, string>;
  isValid: boolean;
  rawInput: string;
}

/**
 * Parses a formula string like `=OPERATION(key1="val1", key2=42)`
 * into a structured object.
 */
export function parseFormula(input: string): ParsedFormula {
  const raw = (input || '').trim();

  if (!raw.startsWith('=')) {
    return { operationId: null, args: {}, isValid: false, rawInput: raw };
  }

  const body = raw.slice(1); // Remove leading '='
  const parenIdx = body.indexOf('(');

  if (parenIdx === -1) {
    // Still typing the operation name — no '(' yet
    return {
      operationId: body.toUpperCase() || null,
      args: {},
      isValid: false,
      rawInput: raw,
    };
  }

  const operationId = body.slice(0, parenIdx);
  if (!operationId) {
    return { operationId: null, args: {}, isValid: false, rawInput: raw };
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
    args,
    isValid: hasClosingParen,
    rawInput: raw,
  };
}

/**
 * Builds a formula string from an operation ID and a key→value config map.
 */
export function buildFormula(
  operationId: string,
  config: Record<string, any>
): string {
  if (!operationId || operationId === 'noop') return '';
  const args = Object.entries(config)
    .filter(([k]) => !k.startsWith('_') || k === '_orchestrator') // skip internal keys except _orchestrator
    .map(([k, v]) => {
      const valStr =
        typeof v === 'string' && !v.startsWith('=') ? `"${v}"` : String(v);
      return `${k}=${valStr}`;
    })
    .join(', ');
  return `=${operationId}(${args})`;
}

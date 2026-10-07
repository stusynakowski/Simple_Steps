/**
 * Parse one console input line.
 *
 * A line is either a **command** (mutates the workflow; applied client-side
 * through the same dispatch the GUI uses) or an **expression** (reads live
 * data; evaluated server-side by `safe_formula`).
 *
 * The split matters: it is what keeps a single path into workflow state. An
 * expression can never smuggle a mutation in, because expressions never reach
 * `dispatch` — see `docs/dev_plan/118-console-and-gui-parity.md` §5 and §7.
 */

import type { WorkflowCommand } from '../types/commands';

export type ParsedLine =
  | { kind: 'command'; command: WorkflowCommand }
  | { kind: 'expression'; source: string }
  | { kind: 'meta'; name: 'steps' | 'help' | 'clear' }
  | { kind: 'error'; message: string };

/** Strip one layer of matching quotes, honouring backslash escapes. */
function unquote(raw: string): string | null {
  const s = raw.trim();
  if (s.length < 2) return null;
  const quote = s[0];
  if ((quote !== '"' && quote !== "'") || s[s.length - 1] !== quote) return null;
  return s.slice(1, -1).replace(/\\(['"\\])/g, '$1');
}

/** Split on top-level commas only — quotes and brackets hold their contents. */
function splitArgs(raw: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let inS = false;
  let inD = false;
  for (const ch of raw) {
    if (ch === "'" && !inD) inS = !inS;
    else if (ch === '"' && !inS) inD = !inD;
    else if (!inS && !inD) {
      if (ch === '[' || ch === '(') depth++;
      else if (ch === ']' || ch === ')') depth--;
      else if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** `name='value'` → ['name', 'value'], else null. */
function kwarg(token: string): [string, string] | null {
  const eq = token.indexOf('=');
  if (eq === -1) return null;
  const name = token.slice(0, eq).trim();
  if (!/^[A-Za-z_]\w*$/.test(name)) return null;
  return [name, token.slice(eq + 1).trim()];
}

export function parseConsoleLine(input: string): ParsedLine {
  const line = input.trim();
  if (!line) return { kind: 'error', message: 'Empty input.' };

  // ── Meta ────────────────────────────────────────────────────────────────
  if (line === 'help' || line === '?') return { kind: 'meta', name: 'help' };
  if (line === 'clear') return { kind: 'meta', name: 'clear' };
  if (line === 'wf.steps' || line === 'wf') return { kind: 'meta', name: 'steps' };

  // ── Assignment: wf["step2"] = '=formula' ────────────────────────────────
  const assign = line.match(/^wf\s*\[\s*(.+?)\s*\]\s*=\s*(.+)$/s);
  if (assign) {
    const target = unquote(assign[1]);
    if (target === null) {
      return { kind: 'error', message: `Step name must be quoted, e.g. wf["step2"] = '=op(…)'` };
    }
    // The right-hand side is a formula. Accept it quoted (the canonical form)
    // or bare, since typing the quotes around a formula is a nuisance by hand.
    const formula = unquote(assign[2]) ?? assign[2].trim();
    if (!formula) return { kind: 'error', message: 'Assignment needs a formula.' };
    return { kind: 'command', command: { kind: 'set', target, formula } };
  }

  // ── Resources: res["llm"] = Type(…)  /  del res["llm"] ───────────────────
  const defineRes = line.match(/^res\s*\[\s*(.+?)\s*\]\s*=\s*(.+)$/s);
  if (defineRes) {
    const name = unquote(defineRes[1]);
    if (name === null) {
      return { kind: 'error', message: `Resource name must be quoted, e.g. res["llm"] = FakeLLM(model="fake-1")` };
    }
    const definition = defineRes[2].trim();
    if (!definition) return { kind: 'error', message: 'A resource needs a type: res["llm"] = FakeLLM(…)' };
    return { kind: 'command', command: { kind: 'define_resource', name, definition } };
  }
  const delRes = line.match(/^del\s+res\s*\[\s*(.+?)\s*\]\s*$/s);
  if (delRes) {
    const name = unquote(delRes[1]);
    if (name === null) return { kind: 'error', message: 'Resource name must be quoted, e.g. del res["llm"]' };
    return { kind: 'command', command: { kind: 'remove_resource', name } };
  }

  // ── Method call: wf.<name>(args) ────────────────────────────────────────
  const call = line.match(/^wf\.(\w+)\s*\((.*)\)\s*$/s);
  if (call) {
    const [, method, rawArgs] = call;
    const args = splitArgs(rawArgs);
    const positional: string[] = [];
    const kw: Record<string, string> = {};
    for (const a of args) {
      const k = kwarg(a);
      if (k) kw[k[0]] = k[1];
      else positional.push(a.trim());
    }
    const pos = (i: number): string | null => (positional[i] ? unquote(positional[i]) : null);

    switch (method) {
      case 'add': {
        const after = kw.after !== undefined ? unquote(kw.after) : null;
        const name = pos(0) ?? undefined;
        return { kind: 'command', command: { kind: 'add', name, after } };
      }
      case 'remove': {
        const t = pos(0);
        if (!t) return { kind: 'error', message: 'wf.remove() needs a step name, e.g. wf.remove("step2")' };
        return { kind: 'command', command: { kind: 'remove', target: t } };
      }
      case 'rename': {
        const t = pos(0);
        const to = pos(1);
        if (!t || !to) return { kind: 'error', message: 'wf.rename() needs two names, e.g. wf.rename("step2", "scored")' };
        return { kind: 'command', command: { kind: 'rename', target: t, to } };
      }
      case 'run':
        return { kind: 'command', command: { kind: 'run', target: pos(0) } };
      case 'preview': {
        const t = pos(0);
        if (!t) return { kind: 'error', message: 'wf.preview() needs a step name.' };
        return { kind: 'command', command: { kind: 'preview', target: t } };
      }
      default:
        return { kind: 'error', message: `Unknown command 'wf.${method}'. Type help for the list.` };
    }
  }

  // ── Anything else is an expression for the backend to evaluate ──────────
  if (/^wf\b/.test(line)) {
    return { kind: 'error', message: `Could not parse '${line}'. Type help for the command list.` };
  }
  return { kind: 'expression', source: line };
}

import type { Step } from '../types/models';
import type { ResourceDeclaration } from '../services/api';

/**
 * Helpers for the workflow's resources (docs/dev_plan/122 §2.4): showing a
 * declaration as the formula that creates it, and finding which steps use one.
 */

/** A literal as Python writes it, so a definition reads like the formula it came from. */
export function pyLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `[${value.map(pyLiteral).join(', ')}]`;
  if (typeof value === 'object') {
    const items = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${JSON.stringify(k)}: ${pyLiteral(v)}`);
    return `{${items.join(', ')}}`;
  }
  return String(value);
}

/** `{type: "FakeLLM", settings: {model: "fake-1"}}` → `FakeLLM(model="fake-1")`. */
export function definitionText(decl: ResourceDeclaration): string {
  const settings = Object.entries(decl.settings ?? {})
    .map(([k, v]) => `${k}=${pyLiteral(v)}`)
    .join(', ');
  return `${decl.type}(${settings})`;
}

/** The steps whose formula uses `res["name"]` (either quote style), by label. */
export function stepsUsingResource(steps: Step[], name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\bres\\s*\\[\\s*(["'])${escaped}\\1\\s*\\]`);
  return steps.filter((s) => pattern.test(s.formula ?? '')).map((s) => s.label);
}

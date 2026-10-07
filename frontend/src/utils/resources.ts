import type { Step } from '../types/models';
import type { LoadedResourceInfo, ResourceDeclaration } from '../services/api';

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * The settings a declaration builds with, as far as the UI may know them.
 * Defined: its `settings`. Ready-made: the deployment's current settings (or,
 * if the deployment doesn't provide it, what they were when saved) with the
 * user's `overrides` on top. Settings read from the environment never appear.
 */
export function effectiveSettings(
  decl: ResourceDeclaration,
  loaded?: LoadedResourceInfo,
): Record<string, unknown> {
  if (decl.source !== 'loaded') return asRecord(decl.settings);
  const base = loaded ? loaded.settings : asRecord(decl.as_loaded);
  return { ...base, ...asRecord(decl.overrides) };
}

/** `{type: "FakeLLM", settings: {model: "fake-1"}}` → `FakeLLM(model="fake-1")`. */
export function definitionText(decl: ResourceDeclaration, loaded?: LoadedResourceInfo): string {
  const settings = Object.entries(effectiveSettings(decl, loaded))
    .map(([k, v]) => `${k}=${pyLiteral(v)}`)
    .join(', ');
  return `${decl.type}(${settings})`;
}

/**
 * What needs the user's attention about a ready-made resource, or null:
 * the deployment doesn't provide it here, or its settings changed since the
 * workflow was saved (`as_loaded`).
 */
export function loadedProblem(
  decl: ResourceDeclaration,
  loaded: LoadedResourceInfo | undefined,
): { kind: 'missing' | 'changed'; detail: string } | null {
  if (decl.source !== 'loaded') return null;
  if (!loaded) return { kind: 'missing', detail: "The deployment doesn't provide it here." };
  const before = asRecord(decl.as_loaded);
  const changed = Object.keys({ ...before, ...loaded.settings })
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(loaded.settings[k]))
    .map((k) => `${k}: ${pyLiteral(before[k])} → ${pyLiteral(loaded.settings[k])}`);
  return changed.length
    ? { kind: 'changed', detail: `Deployment settings changed since saved (${changed.join(', ')}).` }
    : null;
}

/** The steps whose formula uses `res["name"]` (either quote style), by label. */
export function stepsUsingResource(steps: Step[], name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\bres\\s*\\[\\s*(["'])${escaped}\\1\\s*\\]`);
  return steps.filter((s) => pattern.test(s.formula ?? '')).map((s) => s.label);
}

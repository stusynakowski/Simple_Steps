/**
 * Agent API: the Simple Steps Copilot on the backend (plan 128): its status,
 * one checked proposal per request, and its settings.
 */


// Dynamically resolve backend origin so multiple instances on different
// ports work correctly (Streamlit-style port auto-increment).
function resolveBackendOrigin(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const envBase = (import.meta as any).env?.VITE_API_BASE;
  if (envBase) {
    // Strip trailing /api if present to get the origin
    return envBase.replace(/\/api\/?$/, '');
  }
  // If served by the backend itself (bundled), use same-origin
  if (window.location.port && window.location.port !== '5173') {
    return window.location.origin;
  }
  // Vite dev server default
  return 'http://localhost:8000';
}

const _BACKEND_ORIGIN = resolveBackendOrigin();
const API_BASE = `${_BACKEND_ORIGIN}/api/agent`;

// ── Proposals (docs/dev_plan/122 §3) ───────────────────────────────────────

/** Whether the agent can run, with which model — or why it can't. */
export interface AgentStatus {
  available: boolean;
  model?: string;
  provider?: string;
  reason?: string;
}

export async function getAgentStatus(): Promise<AgentStatus> {
  const r = await fetch(`${API_BASE}/status`, { credentials: 'include' });
  if (!r.ok) return { available: false, reason: 'The agent status could not be read.' };
  return r.json();
}

/** One step as the agent reads it: its formula, status, error and output. */
export interface AgentStepContext {
  name: string;
  formula: string;
  status: string;
  error?: string;
  output_ref?: string;
}

/** Ask the agent for steps; every proposed formula comes back checked. */
export async function proposeChanges(req: {
  message: string;
  steps: AgentStepContext[];
  resources: Record<string, unknown>;
  history: { role: 'user' | 'assistant'; content: string }[];
}): Promise<import('../utils/proposal').AgentProposal> {
  const r = await fetch(`${API_BASE}/propose`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.detail || `The agent failed (${r.status}).`);
  return body;
}

// ── Settings (plan 128, M2) ─────────────────────────────────────────────────

/** The copilot's model setting as the browser may see it: never the key. */
export interface AgentSettings {
  /** app: set in the App's code (read-only here); saved; default: a local Ollama; off. */
  source: 'app' | 'saved' | 'default' | 'off';
  api?: 'openai' | 'anthropic';
  provider?: string;
  model?: string;
  base_url?: string;
  api_key_env?: string;
  /** Whether a key is set; the key itself never leaves the server. */
  api_key_set?: boolean;
  temperature?: number;
  max_tokens?: number;
  reason?: string;
}

/** What the panel saves or tests. ``api_key`` is write-only: a value sets it, "" clears it. */
export interface AgentSettingsPatch {
  api?: 'openai' | 'anthropic';
  model?: string;
  base_url?: string;
  api_key_env?: string;
  api_key?: string;
  temperature?: number;
}

export interface AgentTestResult { ok: boolean; model: string; detail: string }

export async function getAgentSettings(): Promise<AgentSettings> {
  const r = await fetch(`${API_BASE}/config`, { credentials: 'include' });
  if (!r.ok) throw new Error('The copilot settings could not be read.');
  return r.json();
}

export async function saveAgentSettings(patch: AgentSettingsPatch): Promise<AgentSettings> {
  const r = await fetch(`${API_BASE}/config`, {
    method: 'PUT', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? 'The settings could not be saved.');
  return r.json();
}

/** One tiny real request with *settings* (unsaved), or the setting in use. */
export async function testAgentConnection(settings?: AgentSettingsPatch): Promise<AgentTestResult> {
  const r = await fetch(`${API_BASE}/test`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings ?? {}),
  });
  if (!r.ok) return { ok: false, model: settings?.model ?? '', detail: 'The server could not run the test.' };
  return r.json();
}

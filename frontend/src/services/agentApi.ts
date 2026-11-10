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

// ── Settings ─────────────────────────────────────────────────────────────────

export interface AgentConfig {
  provider: 'openai' | 'anthropic' | 'ollama' | 'azure_openai';
  model: string;
  api_key?: string | null;
  base_url?: string | null;
  temperature: number;
  max_tokens: number;
  system_prompt_override?: string | null;
  max_iterations: number;
  auto_suggest: boolean;
  show_reasoning: boolean;
}

/** Fetch current agent config. */
export async function getAgentConfig(): Promise<AgentConfig> {
  const r = await fetch(`${API_BASE}/config`);
  if (!r.ok) throw new Error('Failed to fetch agent config');
  return r.json();
}

/** Partially update agent config. */
export async function updateAgentConfig(patch: Partial<AgentConfig>): Promise<AgentConfig> {
  const r = await fetch(`${API_BASE}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error('Failed to update agent config');
  return r.json();
}

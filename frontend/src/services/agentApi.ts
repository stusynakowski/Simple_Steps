/**
 * Agent API service — communicates with the LangGraph-powered
 * step-definition assistant on the backend.
 *
 * Supports both single-shot REST calls and WebSocket streaming.
 */

import type { Step } from '../types/models';
import type { OperationDefinition } from './api';

// Dynamically resolve backend origin so multiple instances on different
// ports work correctly (Streamlit-style port auto-increment).
function resolveBackendOrigin(): string {
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
const WS_BASE = `${_BACKEND_ORIGIN.replace(/^http/, 'ws')}/api/agent`;

// ── Types ────────────────────────────────────────────────────────────────────

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

export interface AgentHealthStatus {
  provider: string;
  model: string;
  langchain_core: boolean;
  langgraph: boolean;
  provider_package: boolean;
  api_key_set: boolean;
  ready: boolean;
  install_hint?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  suggested_formula?: string | null;
  isStreaming?: boolean;
}

interface ChatRequestPayload {
  message: string;
  workflow_steps: Array<Record<string, unknown>>;
  available_operations: Array<Record<string, unknown>>;
  current_step?: Record<string, unknown> | null;
  conversation_history: Array<{ role: string; content: string }>;
}

interface ChatResponse {
  message: string;
  suggested_formula?: string | null;
  error?: string | null;
}

// ── REST API ─────────────────────────────────────────────────────────────────

/** Single-shot chat: send message, get complete response. */
export async function sendAgentMessage(
  message: string,
  workflowSteps: Step[],
  availableOperations: OperationDefinition[],
  currentStep?: Step | null,
  conversationHistory?: ChatMessage[],
): Promise<ChatResponse> {
  const payload: ChatRequestPayload = {
    message,
    workflow_steps: workflowSteps.map(s => ({
      id: s.id,
      sequence_index: s.sequence_index,
      label: s.label,
      formula: s.formula,
      process_type: s.process_type,
      configuration: s.configuration,
      status: s.status,
    })),
    available_operations: availableOperations.map(op => ({
      id: op.id,
      label: op.label,
      type: op.type,
      category: op.category,
      description: op.description,
      params: op.params,
    })),
    current_step: currentStep
      ? {
          id: currentStep.id,
          label: currentStep.label,
          formula: currentStep.formula,
          process_type: currentStep.process_type,
          configuration: currentStep.configuration,
          status: currentStep.status,
        }
      : null,
    conversation_history: (conversationHistory ?? [])
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content })),
  };

  const r = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Agent chat failed: ${err}`);
  }

  return r.json();
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

/** Check agent health/readiness. */
export async function getAgentHealth(): Promise<AgentHealthStatus> {
  const r = await fetch(`${API_BASE}/health`);
  if (!r.ok) throw new Error('Failed to check agent health');
  return r.json();
}

// ── WebSocket Streaming ──────────────────────────────────────────────────────

type TokenCallback = (token: string) => void;
type DoneCallback = (fullMessage: string, suggestedFormula?: string | null) => void;
type ErrorCallback = (error: string) => void;

/**
 * Open a persistent WebSocket connection to the agent streaming endpoint.
 * Returns an object with `send()` and `close()` methods.
 */
export function createAgentWebSocket(
  onToken: TokenCallback,
  onDone: DoneCallback,
  onError: ErrorCallback,
  onOpen?: () => void,
  onClose?: () => void,
): {
  send: (
    message: string,
    workflowSteps: Step[],
    availableOperations: OperationDefinition[],
    currentStep?: Step | null,
    conversationHistory?: ChatMessage[],
  ) => void;
  close: () => void;
  isConnected: () => boolean;
} {
  let ws: WebSocket | null = null;
  let connected = false;

  function connect() {
    ws = new WebSocket(`${WS_BASE}/chat/stream`);

    ws.onopen = () => {
      connected = true;
      onOpen?.();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'token') {
          onToken(data.content);
        } else if (data.type === 'done') {
          onDone(data.content, data.suggested_formula);
        } else if (data.type === 'error') {
          onError(data.content);
        }
      } catch {
        onError('Failed to parse agent response');
      }
    };

    ws.onerror = () => {
      onError('WebSocket connection error');
    };

    ws.onclose = () => {
      connected = false;
      onClose?.();
    };
  }

  connect();

  return {
    send(
      message: string,
      workflowSteps: Step[],
      availableOperations: OperationDefinition[],
      currentStep?: Step | null,
      conversationHistory?: ChatMessage[],
    ) {
      if (!ws || !connected) {
        connect();
        // Retry after connection
        setTimeout(() => {
          this.send(message, workflowSteps, availableOperations, currentStep, conversationHistory);
        }, 500);
        return;
      }

      const payload: ChatRequestPayload = {
        message,
        workflow_steps: workflowSteps.map(s => ({
          id: s.id,
          sequence_index: s.sequence_index,
          label: s.label,
          formula: s.formula,
          process_type: s.process_type,
          configuration: s.configuration,
          status: s.status,
        })),
        available_operations: availableOperations.map(op => ({
          id: op.id,
          label: op.label,
          type: op.type,
          category: op.category,
          description: op.description,
          params: op.params,
        })),
        current_step: currentStep
          ? {
              id: currentStep.id,
              label: currentStep.label,
              formula: currentStep.formula,
              process_type: currentStep.process_type,
              configuration: currentStep.configuration,
              status: currentStep.status,
            }
          : null,
        conversation_history: (conversationHistory ?? [])
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({ role: m.role, content: m.content })),
      };

      ws.send(JSON.stringify(payload));
    },

    close() {
      ws?.close();
      ws = null;
      connected = false;
    },

    isConnected() {
      return connected;
    },
  };
}

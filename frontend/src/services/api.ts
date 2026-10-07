import type { StepConfiguration } from '../types/models';

// When the frontend is bundled and served by the backend, use same-origin.
// When running via Vite dev server, the backend defaults to :8000 but can
// auto-increment to :8001, :8002, etc.  Allow override via env var or
// fall back to same-origin (works when served from the backend directly).
function resolveApiBase(): string {
  // Vite injects env vars prefixed with VITE_
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const envBase = (import.meta as any).env?.VITE_API_BASE;
  if (envBase) return envBase;

  // If served by the backend itself (bundled), use same-origin
  if (window.location.port && window.location.port !== '5173') {
    return `${window.location.origin}/api`;
  }

  // Vite dev server default — assume backend is on :8000
  return '/api';
}

import { emitConsoleRecord } from '../context/ConsoleContext';

export const API_BASE = resolveApiBase();

// ── Session bootstrap ────────────────────────────────────────────────────────
// Session identity is server-issued and stored in an HttpOnly cookie
// (`ss_session`).  We never see, store, or send the session ID from JS —
// the browser carries the cookie automatically on every request.  All
// `fetch` and `EventSource` calls in this module set `credentials: 'include'`
// (and `withCredentials: true`) so the cookie flows even in cross-origin
// dev setups.
//
// Call `bootstrapSession()` once on app boot; subsequent requests reuse
// the cookie transparently.

export interface SessionInfo {
  ok: boolean;
  /** First 8 hex chars of the session id — for diagnostics only. */
  session_token: string;
}

/**
 * Idempotent — ensures the browser has an `ss_session` cookie.  The
 * full session id is HttpOnly; we only get a short prefix back for
 * display / debugging.
 */
export async function bootstrapSession(): Promise<SessionInfo> {
  const r = await fetch(`${API_BASE}/session`, {
    credentials: 'include',
  });
  if (!r.ok) throw new Error('Failed to bootstrap session');
  return r.json();
}

export interface ProgressEvent {
  current: number;
  total: number;
  message: string;
  elapsed: number;
  done?: boolean;
}

/**
 * Opens an SSE connection to stream progress for a running step.
 * Returns a cleanup function to close the connection.
 *
 * `withCredentials: true` ensures the session cookie flows on the
 * EventSource handshake; without it, cross-origin SSE in dev would
 * be unauthenticated and the backend would route progress to a
 * different (anonymous) session bucket.
 */
export function listenProgress(
  stepId: string,
  onProgress: (evt: ProgressEvent) => void,
  onDone?: () => void,
): () => void {
  const url = `${API_BASE}/progress/${stepId}`;
  const source = new EventSource(url, { withCredentials: true });
  source.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as ProgressEvent;
      if (data.done) {
        source.close();
        onDone?.();
      } else {
        onProgress(data);
      }
    } catch { /* ignore parse errors */ }
  };
  source.onerror = () => {
    source.close();
    onDone?.();
  };
  return () => source.close();
}

interface StepRunResponse {
  status: 'success' | 'failed';
  output_ref_id: string;
  metrics: {
    rows: number;
    columns: string[];
    /** Set when the step ran on simple_steps_core's grid model. */
    engine?: 'grid';
    /** The shape verb core ran (map, filter, select, …). */
    verb?: string;
    /** Units of work (rows, groups, …) and how many of them failed. */
    units?: number;
    failed?: number;
    /** The first few per-unit errors from core's ledger. */
    errors?: { unit: string; error: string }[];
    /** The column the step wrote its result to, when it is in the output. */
    payload_column?: string | null;
    /** Each failed unit's error, keyed by its row position in the output. */
    row_errors?: Record<string, string>;
  };
  error?: string;
}

/** Structured error returned by the backend when a step execution fails. */
export interface BackendError {
  detail: string;
  error_type?: string;
  traceback?: string;
  operation_id?: string;
  step_id?: string;
}

export interface OperationParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'list' | 'object' | 'dataframe';
  /** From the tool's docstring Args: section. Empty when undocumented. */
  description: string;
  default?: unknown;
  /** True when the parameter has no default. Mirrors core's ToolParam.required. */
  required?: boolean;
  /**
   * 'resource' params are injected by the engine from the resource container
   * and must NOT be rendered as user-editable form fields.
   * Mirrors core's ToolParam.kind.
   */
  kind?: 'data' | 'resource';
  /**
   * Allowed values for a Literal-annotated parameter. Present means render a
   * dropdown restricted to these; absent/null means a free-text field.
   */
  options?: (string | number | boolean)[] | null;
}

/** What a tool returns, derived from its return annotation + docstring. */
export interface OperationReturn {
  type: string;
  /** core's cardinality word for tabular returns. */
  form?: 'grid' | 'column' | 'scalar' | null;
  description: string;
}

export interface OperationDefinition {
  id: string;
  label: string;
  description: string;
  /**
   * The default orchestration mode registered by the @simple_step_tool
   * decorator. 'step' is the v0.2 single-cell default.
   */
  type: 'step' | 'source' | 'map' | 'filter' | 'dataframe' | 'expand' | 'raw_output' | 'orchestrator' | 'verb';
  category: string;
  params: OperationParam[];
  /** Output contract. Null when the tool has no return annotation. */
  returns?: OperationReturn | null;
  /** The resource this tool is bound to, if any ('reshape', 'file_system', …). */
  resource?: string | null;
  /** Resource container keys the engine injects for this tool. */
  dependencies?: string[];
}

/**
 * Fetches the catalogue of available operations.
 */
export async function getOperations(): Promise<OperationDefinition[]> {
  const response = await fetch(`${API_BASE}/operations`);
  if (!response.ok) throw new Error("Failed to fetch operations");
  return response.json();
}

/** One setting of a core verb, from ``grid.modifier_catalog()``. */
export interface ModifierSetting {
  name: string;
  type: string | null;
  required: boolean;
  default: unknown;
  description?: string;
}

/** A core verb (shape) or execution modifier, from ``GET /api/modifiers``. */
export interface ModifierInfo {
  name: string;
  class: 'shape' | 'execution';
  row_rule: string | null;
  settings: ModifierSetting[];
}

let modifiersCache: Promise<Record<string, ModifierInfo>> | null = null;

/**
 * Core's verb vocabulary. Fetched once per page load: it only changes when
 * simple-steps-core is upgraded, which restarts the server.
 */
export function getModifiers(): Promise<Record<string, ModifierInfo>> {
  if (!modifiersCache) {
    modifiersCache = fetch(`${API_BASE}/modifiers`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to fetch modifiers');
        return r.json();
      })
      .then((body) => body.modifiers as Record<string, ModifierInfo>)
      .catch((err) => {
        modifiersCache = null;   // let the next caller retry
        throw err;
      });
  }
  return modifiersCache;
}

/**
 * Validates connection to the backend.
 */
export async function checkBackendStatus(): Promise<boolean> {
    try {
        await fetch(`${API_BASE}/operations`);
        return true;
    } catch {
        return false;
    }
}

/**
 * Executes a single step on the backend.
 * Returns the reference ID for the result, not the data itself.
 *
 * Note: there is no `sessionId` parameter.  Session identity is
 * server-issued via the `ss_session` HttpOnly cookie and resolved
 * from `Depends(get_session_id)` in the backend route.  Clients
 * cannot set or spoof it.
 */
export async function runStep(
    stepId: string,
    operationId: string,
    configuration: StepConfiguration,
    inputRefId: string | null,
    stepMap?: Record<string, string>,
    isPreview: boolean = false,
    formula?: string,
    resultStore?: 'memory' | 'parquet',
    resources?: Record<string, unknown>,
): Promise<StepRunResponse> {
  
  const payload = {
      step_id: stepId,
      operation_id: operationId,
      config: configuration,
      input_ref_id: inputRefId,
      step_map: stepMap || {},
      is_preview: isPreview,
      formula: formula || null,
      result_store: resultStore || null,
      // The workflow's `resources` section (declarations, never objects). A
      // formula naming res["…"] is checked and run against it.
      resources: resources || null,
  };

  // Wire tap. This records the payload at the fetch boundary — the bytes that
  // actually go out — rather than reconstructing it from workflow state. A
  // reconstruction is a *model* of the request; if it drifts it reports a
  // parity that does not exist, which is the failure mode the console exists
  // to rule out. See docs/dev_plan/118-console-and-gui-parity.md §3.
  const startedAt = performance.now();
  emitConsoleRecord({
    stream: 'wire',
    text: `POST /api/run  ${payload.operation_id || '(none)'}  step=${payload.step_id}${payload.is_preview ? '  [preview]' : ''}`,
    detail: JSON.stringify(payload, null, 2),
  });

  const response = await fetch(`${API_BASE}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
  });

  if (!response.ok) {
      // Try to parse structured error from backend
      let errorInfo: BackendError | null = null;
      try {
        errorInfo = await response.json();
      } catch {
        // non-JSON response
      }
      const err = new Error(errorInfo?.detail || `Backend Error: ${response.statusText}`) as Error & { backendError?: BackendError };
      if (errorInfo) {
        err.backendError = errorInfo;
      }
      emitConsoleRecord({
        stream: 'wire',
        level: 'error',
        text: `  ← ${response.status} ${response.statusText}  ${err.message}`,
        detail: errorInfo?.traceback ?? undefined,
        durationMs: Math.round(performance.now() - startedAt),
      });
      throw err;
  }

  const body = await response.json();
  emitConsoleRecord({
    stream: 'wire',
    text: `  ← 200  ref=${body.output_ref_id ?? '(none)'}`
        + (body.metrics ? `  ${body.metrics.rows} rows x ${body.metrics.columns ?? '?'} cols` : ''),
    durationMs: Math.round(performance.now() - startedAt),
  });
  return body;
}

/**
 * Fetches a slice of data for the grid view using a reference ID.
 * Session-scoped — the backend rejects refs that belong to a
 * different session (404), preventing cross-session data leaks.
 */
export async function fetchDataView(
    refId: string, 
    offset: number = 0, 
    limit: number = 50
): Promise<unknown[]> {
    const response = await fetch(`${API_BASE}/data/${refId}?offset=${offset}&limit=${limit}`, {
        credentials: 'include',
    });
    if (!response.ok) {
        // If 404, maybe ref expired.
        throw new Error('Data not found');
    }
    return response.json();
}

export interface DataMeta {
    rows: number;
    columns: string[];
}

/** Fetches lightweight metadata (row/column counts) for a data reference. */
export async function fetchDataMeta(refId: string): Promise<DataMeta> {
    const response = await fetch(`${API_BASE}/data-meta/${refId}`, {
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error('Data metadata not found');
    }
    return response.json();
}

// --- Project / Pipeline Persistence ---

/** A project is a folder that contains pipeline files. */
export interface ProjectInfo {
    id: string;       // folder slug
    name: string;     // display name
    pipelines: string[];  // pipeline id slugs present in the folder
}

/** A single step inside a pipeline file. */
export interface StepConfig {
    step_id: string;
    operation_id: string;
    label: string;
    config: Record<string, unknown>;
    /** Canonical formula string — the single source of truth for what this step executes. */
    formula?: string;
}

/** The pipeline definition written to disk — no runtime data. */
export interface PipelineFile {
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
    steps: StepConfig[];
    meta?: Record<string, unknown>;
    /** Resources the steps use: name → {source, type, settings} (core 007). */
    resources?: Record<string, unknown>;
    /** Any other top-level section, kept as-is so a save never drops it. */
    [section: string]: unknown;
}

// ── Projects (folders) ────────────────────────────────────────────────────

export async function listProjects(): Promise<ProjectInfo[]> {
    const r = await fetch(`${API_BASE}/projects`);
    if (!r.ok) throw new Error('Failed to list projects');
    return r.json();
}

export async function createProject(name: string): Promise<ProjectInfo> {
    const r = await fetch(`${API_BASE}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
    });
    if (!r.ok) throw new Error('Failed to create project');
    return r.json();
}

export async function deleteProject(projectId: string): Promise<void> {
    const p = encodeURIComponent(projectId);
    const r = await fetch(`${API_BASE}/projects/${p}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Failed to delete project');
}

// ── Pipelines (files inside a project) ───────────────────────────────────

export async function listPipelines(projectId: string): Promise<PipelineFile[]> {
    const p = encodeURIComponent(projectId);
    const r = await fetch(`${API_BASE}/projects/${p}/pipelines`);
    if (!r.ok) throw new Error('Failed to list pipelines');
    return r.json();
}

export async function loadPipeline(projectId: string, pipelineId: string): Promise<PipelineFile> {
    const p = encodeURIComponent(projectId);
    const f = encodeURIComponent(pipelineId);
    const r = await fetch(`${API_BASE}/projects/${p}/pipelines/${f}`);
    if (!r.ok) throw new Error('Pipeline not found');
    return r.json();
}

// ── Cell views (docs/dev_plan/122 §4) ───────────────────────────────────────

/** One cell's full view, for the cell viewer (GET /api/cell/{ref}). */
export interface CellView {
    cell_type: string | null;
    summary: string;
    view:
        | { kind: 'image'; src: string; width: number; height: number }
        | { kind: 'plotly'; figure: { data?: unknown[]; layout?: Record<string, unknown> } }
        | { kind: 'table'; columns: string[]; rows: unknown[][]; total: number }
        | { kind: 'json'; value: unknown }
        | { kind: 'text'; text: string };
}

export async function fetchCellView(refId: string, row: number, column: string): Promise<CellView> {
    const qs = new URLSearchParams({ row: String(row), column });
    const r = await fetch(`${API_BASE}/cell/${encodeURIComponent(refId)}?${qs}`, { credentials: 'include' });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.detail || 'Failed to load the cell');
    return body;
}

// ── Resources (core 007) ────────────────────────────────────────────────────

/** One saved resource: a type and literal settings, never an object. */
export interface ResourceDeclaration {
    source: 'defined' | 'loaded';
    type: string;
    settings?: Record<string, unknown>;
    [field: string]: unknown;
}

/** A resource type the app offers (GET /api/resources), from core's resource_entry. */
export interface ResourceTypeInfo {
    type: string;
    description?: string;
    settings: { name: string; type: string; required: boolean; default?: unknown }[];
    tools: Record<string, { description?: string }>;
    bases?: string[];
}

/** A ready-made resource the deployment provides (GET /api/resources/loaded).
 *  Settings read from the environment appear only as `env:NAME` pointers. */
export interface LoadedResourceInfo {
    type: string;
    settings: Record<string, unknown>;
    from_env: Record<string, string>;
    locked: string[];
}

export async function fetchLoadedResources(): Promise<Record<string, LoadedResourceInfo>> {
    const r = await fetch(`${API_BASE}/resources/loaded`, { credentials: 'include' });
    if (!r.ok) throw new Error('Failed to list ready-made resources');
    return r.json();
}

export async function fetchResourceTypes(): Promise<Record<string, ResourceTypeInfo>> {
    const r = await fetch(`${API_BASE}/resources`, { credentials: 'include' });
    if (!r.ok) throw new Error('Failed to list resource types');
    return r.json();
}

/** Check `Claude(model="…")` for resource *name*; returns what the workflow saves. */
export async function declareResource(
    name: string,
    definition: string,
): Promise<{ name: string; declaration: ResourceDeclaration }> {
    const r = await fetch(`${API_BASE}/resources/declare`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, definition }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.detail || 'Failed to declare the resource');
    return body;
}

export async function savePipeline(projectId: string, pipeline: PipelineFile): Promise<PipelineFile> {
    const p = encodeURIComponent(projectId);
    const r = await fetch(`${API_BASE}/projects/${p}/pipelines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pipeline),
    });
    if (!r.ok) throw new Error('Failed to save pipeline');
    return r.json();
}

export async function deletePipeline(projectId: string, pipelineId: string): Promise<void> {
    const p = encodeURIComponent(projectId);
    const f = encodeURIComponent(pipelineId);
    const r = await fetch(`${API_BASE}/projects/${p}/pipelines/${f}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Failed to delete pipeline');
}

// --- Debug / Diagnostics ---

// --- Workspace Info ---

/** A previously-opened workspace as recorded in ``~/.simple_steps/state.json``. */
export interface RecentWorkspace {
    path: string;
    opened_at: string;  // ISO-8601 UTC
}

/** Information about the current workspace that Simple Steps was launched from. */
export interface WorkspaceInfo {
    workspace_root: string;
    /** Short display name (basename of workspace_root). */
    name: string;
    projects_dir: string;
    project_count: number;
    pipeline_count: number;
    project_names: string[];
    has_packs: boolean;
    has_ops: boolean;
    has_manifest: boolean;
    developer_pack_dirs: string[];
    ops_by_tier: Record<string, string[]>;
    total_operations: number;
    /** Recently-opened workspaces, newest first.  Phase A. */
    recent_workspaces: RecentWorkspace[];
}

/** Fetch workspace information from the backend. */
export async function fetchWorkspaceInfo(): Promise<WorkspaceInfo> {
    const r = await fetch(`${API_BASE}/workspace`);
    if (!r.ok) throw new Error('Failed to fetch workspace info');
    return r.json();
}

/** Result of ``POST /api/workspace/open``. */
export interface OpenWorkspaceResult {
    ok: boolean;
    workspace: string;
    /** True if a backend restart is required for the switch to take effect. */
    requires_restart: boolean;
    recent_workspaces: RecentWorkspace[];
}

/** Record ``path`` as the active workspace; pushes to recents. */
export async function openWorkspace(path: string): Promise<OpenWorkspaceResult> {
    const r = await fetch(`${API_BASE}/workspace/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
    });
    if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: 'Failed to open workspace' }));
        throw new Error(err.detail || 'Failed to open workspace');
    }
    return r.json();
}

// --- File Tree (IDE-like workspace browser) ---

export interface FileEntry {
    name: string;
    type: 'file' | 'directory';
    /** Discriminator added in Phase A.3.  ``pipeline`` is a workflow file under
     *  ``projects/`` — render with a distinct glyph and open as a workflow tab. */
    kind?: 'file' | 'directory' | 'pipeline';
    path: string;   // relative to workspace root
}

export interface FileTreeResponse {
    workspace_root: string;
    relative_path: string;
    entries: FileEntry[];
}

/** List files/directories at the given path (relative to workspace root). */
export async function fetchFileTree(path = ''): Promise<FileTreeResponse> {
    const r = await fetch(`${API_BASE}/files?path=${encodeURIComponent(path)}`);
    if (!r.ok) throw new Error('Failed to list files');
    return r.json();
}

/** Read a file's content (relative to workspace root). */
export async function readWorkspaceFile(path: string): Promise<{ path: string; content: string | null; size: number }> {
    const r = await fetch(`${API_BASE}/files/read?path=${encodeURIComponent(path)}`);
    if (!r.ok) throw new Error('Failed to read file');
    return r.json();
}

/** Write a file's content (relative to workspace root). */
export async function writeWorkspaceFile(path: string, content: string): Promise<{ path: string; size: number; saved: boolean }> {
    const r = await fetch(`${API_BASE}/files/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content }),
    });
    if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: 'Failed to write file' }));
        throw new Error(err.detail || 'Failed to write file');
    }
    return r.json();
}

// --- Settings ---

export interface SimpleStepsSettings {
    eval_mode: boolean;
    result_store: 'memory' | 'parquet';
}

/** Fetch current runtime settings. */
export async function fetchSettings(): Promise<SimpleStepsSettings> {
    const r = await fetch(`${API_BASE}/settings`);
    if (!r.ok) throw new Error('Failed to fetch settings');
    return r.json();
}

/** Update runtime settings. */
export async function updateSettings(updates: Partial<SimpleStepsSettings>): Promise<SimpleStepsSettings> {
    const r = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
    });
    if (!r.ok) throw new Error('Failed to update settings');
    return r.json();
}


// ── Console ────────────────────────────────────────────────────────────────

export interface ConsoleEvalResult {
  ok: boolean;
  kind?: string;
  shape?: string;
  columns?: string[];
  repr?: string;
  truncated?: boolean;
  error?: string;
  error_type?: string;
  available_steps?: string[];
}

/**
 * Evaluate one console expression against live session data.
 *
 * Read-only: the backend runs this through `safe_formula`, the AST-allowlist
 * interpreter, so an expression can neither mutate the workflow nor reach
 * outside the registered operations.
 */
export async function evalConsole(
  source: string,
  stepMap: Record<string, string>,
): Promise<ConsoleEvalResult> {
  const response = await fetch(`${API_BASE}/console/eval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ source, step_map: stepMap }),
  });
  if (!response.ok) {
    return { ok: false, error: `Backend error: ${response.status} ${response.statusText}` };
  }
  return response.json();
}

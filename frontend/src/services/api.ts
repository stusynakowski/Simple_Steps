import type { StepConfiguration } from '../types/models';

// When the frontend is bundled and served by the backend, use same-origin.
// When running via Vite dev server, the backend defaults to :8000 but can
// auto-increment to :8001, :8002, etc.  Allow override via env var or
// fall back to same-origin (works when served from the backend directly).
function resolveApiBase(): string {
  // Vite injects env vars prefixed with VITE_
  const envBase = (import.meta as any).env?.VITE_API_BASE;
  if (envBase) return envBase;

  // If served by the backend itself (bundled), use same-origin
  if (window.location.port && window.location.port !== '5173') {
    return `${window.location.origin}/api`;
  }

  // Vite dev server default — assume backend is on :8000
  return 'http://localhost:8000/api';
}

const API_BASE = resolveApiBase();

interface StepRunResponse {
  status: 'success' | 'failed';
  output_ref_id: string;
  metrics: {
    rows: number;
    columns: string[];
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
  type: 'string' | 'number' | 'boolean' | 'list';
  description: string;
  default?: any;
}

export interface OperationDefinition {
  id: string;
  label: string;
  description: string;
  /** The default orchestration mode registered by the @simple_step decorator. */
  type: 'source' | 'map' | 'filter' | 'dataframe' | 'expand' | 'raw_output' | 'orchestrator';
  category: string;
  params: OperationParam[];
}

/**
 * Fetches the catalogue of available operations.
 */
export async function getOperations(): Promise<OperationDefinition[]> {
  const response = await fetch(`${API_BASE}/operations`);
  if (!response.ok) throw new Error("Failed to fetch operations");
  return response.json();
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
 */
export async function runStep(
    stepId: string, 
    operationId: string,
    configuration: StepConfiguration,
    inputRefId: string | null,
    stepMap?: Record<string, string>,
    isPreview: boolean = false
): Promise<StepRunResponse> {
  
  const payload = {
      step_id: stepId,
      operation_id: operationId,
      config: configuration,
      input_ref_id: inputRefId,
      step_map: stepMap || {},
      is_preview: isPreview
  };

  const response = await fetch(`${API_BASE}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      throw err;
  }

  return response.json();
}

/**
 * Fetches a slice of data for the grid view using a reference ID.
 */
export async function fetchDataView(
    refId: string, 
    offset: number = 0, 
    limit: number = 50
): Promise<any[]> {
    const response = await fetch(`${API_BASE}/data/${refId}?offset=${offset}&limit=${limit}`);
    if (!response.ok) {
        // If 404, maybe ref expired.
        throw new Error('Data not found');
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
    const r = await fetch(`${API_BASE}/projects/${projectId}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Failed to delete project');
}

// ── Pipelines (files inside a project) ───────────────────────────────────

export async function listPipelines(projectId: string): Promise<PipelineFile[]> {
    const r = await fetch(`${API_BASE}/projects/${projectId}/pipelines`);
    if (!r.ok) throw new Error('Failed to list pipelines');
    return r.json();
}

export async function loadPipeline(projectId: string, pipelineId: string): Promise<PipelineFile> {
    const r = await fetch(`${API_BASE}/projects/${projectId}/pipelines/${pipelineId}`);
    if (!r.ok) throw new Error('Pipeline not found');
    return r.json();
}

export async function savePipeline(projectId: string, pipeline: PipelineFile): Promise<PipelineFile> {
    const r = await fetch(`${API_BASE}/projects/${projectId}/pipelines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pipeline),
    });
    if (!r.ok) throw new Error('Failed to save pipeline');
    return r.json();
}

export async function deletePipeline(projectId: string, pipelineId: string): Promise<void> {
    const r = await fetch(`${API_BASE}/projects/${projectId}/pipelines/${pipelineId}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Failed to delete pipeline');
}

// Legacy re-exports so old callers don't immediately break
export type ProjectMetadata = ProjectInfo;
export const listProjects_legacy = listProjects;
export const deleteProject_legacy = deleteProject;

// --- Debug / Diagnostics ---

/** Fetch the raw operation registry from the backend for debugging. */
export async function fetchDebugRegistry(): Promise<Record<string, unknown>> {
    const r = await fetch(`${API_BASE}/debug/registry`);
    if (!r.ok) return { error: 'Failed to fetch registry' };
    return r.json();
}

// --- Developer Packs ---

/** A developer pack directory with its loaded operations. */
export interface DeveloperPack {
    id: string;
    name: string;
    path: string;
    operations: string[];
    errors: string[];
    enabled: boolean;
}

/** Fetch all known developer pack directories and their operations. */
export async function fetchDeveloperPacks(): Promise<DeveloperPack[]> {
    const r = await fetch(`${API_BASE}/developer-packs`);
    if (!r.ok) return [];
    return r.json();
}

/** Trigger on-demand loading of project operations (recursive scan). */
export async function loadProjectOps(projectId: string): Promise<{
    project_id: string;
    files_scanned: number;
    ops_registered: string[];
    errors: { file: string; error: string }[];
}> {
    const r = await fetch(`${API_BASE}/projects/${projectId}/load-ops`, { method: 'POST' });
    if (!r.ok) throw new Error('Failed to load project ops');
    return r.json();
}

/** Fetch the three-tier pack loader status. */
export async function fetchLoaderStatus(): Promise<Record<string, unknown>> {
    const r = await fetch(`${API_BASE}/loader`);
    if (!r.ok) return { error: 'Failed to fetch loader status' };
    return r.json();
}

// --- Workspace Info ---

/** Information about the current workspace that Simple Steps was launched from. */
export interface WorkspaceInfo {
    workspace_root: string;
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
}

/** Fetch workspace information from the backend. */
export async function fetchWorkspaceInfo(): Promise<WorkspaceInfo> {
    const r = await fetch(`${API_BASE}/workspace`);
    if (!r.ok) throw new Error('Failed to fetch workspace info');
    return r.json();
}

// --- Pack Management ---

export interface PackInfo {
    name: string;
    source: 'git' | 'local' | 'pip';
    url: string;
    ref: string;
    path: string;
    package: string;
    enabled: boolean;
}

/** List all packs declared in the workspace manifest. */
export async function fetchPacks(): Promise<PackInfo[]> {
    const r = await fetch(`${API_BASE}/packs`);
    if (!r.ok) throw new Error('Failed to fetch packs');
    return r.json();
}

/** Add a pack to the workspace manifest. */
export async function addPack(body: {
    source: 'git' | 'local' | 'pip';
    url?: string;
    path?: string;
    package?: string;
    name?: string;
    ref?: string;
}): Promise<PackInfo> {
    const r = await fetch(`${API_BASE}/packs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(err.detail || 'Failed to add pack');
    }
    return r.json();
}

/** Remove a pack from the workspace manifest. */
export async function removePack(name: string, deleteFiles = false): Promise<void> {
    const r = await fetch(`${API_BASE}/packs/${name}?delete_files=${deleteFiles}`, {
        method: 'DELETE',
    });
    if (!r.ok) throw new Error('Failed to remove pack');
}

/** Install/sync all packs declared in the manifest. */
export async function installPacks(): Promise<{ success: boolean; issues: string[] }> {
    const r = await fetch(`${API_BASE}/packs/install`, { method: 'POST' });
    if (!r.ok) throw new Error('Failed to install packs');
    return r.json();
}

import React, { useState, useEffect, useCallback } from 'react';
import type { ActivityView } from './ActivityBar';
import type { ProjectInfo, PipelineFile, SimpleStepsSettings, OperationDefinition, ResourceDeclaration } from '../services/api';
import { fetchSettings, updateSettings } from '../services/api';
import FileTree from './FileTree';
import EnvironmentExplorer from './EnvironmentExplorer';
import DocsPanel from './DocsPanel';
import './Sidebar.css';

interface SidebarProps {
  isVisible: boolean;
  currentView: ActivityView;
  /** Increment to force the explorer to re-fetch projects/pipelines after a save */
  refreshTrigger?: number;
  /** Registered operations. */
  availableOperations?: OperationDefinition[];
  /** This workflow's resources — listed in the Environment panel. */
  workflowResources?: Record<string, ResourceDeclaration>;
  // Project / pipeline persistence
  onListProjects?: () => Promise<ProjectInfo[]>;
  onCreateProject?: (name: string) => Promise<ProjectInfo>;
  onDeleteProject?: (projectId: string) => Promise<void>;
  onListPipelines?: (projectId: string) => Promise<PipelineFile[]>;
  onLoadPipeline?: (projectId: string, pipelineId: string) => Promise<void>;
  /** Called when user clicks 💾 on a project folder — opens SaveModal in MainLayout */
  onRequestSave?: (projectId: string, projectDisplayName: string) => void;
  onDeletePipeline?: (projectId: string, pipelineId: string) => Promise<void>;
}

// ── Settings Panel ────────────────────────────────────────────────────────

const defaultSettings: SimpleStepsSettings = {
  result_store: 'memory',
};

const SettingsPanel: React.FC = () => {
  const [settings, setSettings] = useState<SimpleStepsSettings>(defaultSettings);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await fetchSettings();
      setSettings({
        result_store: s.result_store ?? 'memory',
      });
    } catch {
      setError('Could not load runtime settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback(async (updates: Partial<SimpleStepsSettings>) => {
    setSaving(true);
    setError(null);
    try {
      const next = await updateSettings(updates);
      setSettings({
        result_store: next.result_store ?? 'memory',
      });
      setSavedAt(Date.now());
    } catch {
      setError('Could not save runtime settings');
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <div className="settings-panel">
      <div className="settings-card">
        <div className="settings-card-title">Execution</div>

        <label className="settings-field">
          <span className="settings-label">Result Storage</span>
          <select
            className="settings-select"
            value={settings.result_store}
            disabled={loading || saving}
            onChange={(e) => {
              const value = e.target.value as 'memory' | 'parquet';
              void persist({ result_store: value });
            }}
          >
            <option value="memory">Memory (fast, volatile)</option>
            <option value="parquet">Parquet cache (persistent)</option>
          </select>
          <span className="settings-help">
            Memory keeps step outputs in RAM only. Parquet writes outputs to disk cache and survives process memory eviction.
          </span>
        </label>
      </div>

      <div className="settings-meta-row">
        <button className="settings-refresh-btn" onClick={() => void load()} disabled={loading || saving}>
          Refresh
        </button>
        {loading && <span className="settings-meta">Loading…</span>}
        {saving && <span className="settings-meta">Saving…</span>}
        {!loading && !saving && savedAt && <span className="settings-meta">Saved</span>}
      </div>

      {error && <div className="settings-error">{error}</div>}
    </div>
  );
};

// ── Main Sidebar ───────────────────────────────────────────────────────────

const Sidebar: React.FC<SidebarProps> = ({ isVisible, currentView, ...rest }) => {
  if (!isVisible) return null;

  const encodeWorkspaceProjectId = (relDir: string): string => {
    // Match backend virtual project id format: ws_<urlsafe_base64(rel_path)>
    const bytes = new TextEncoder().encode(relDir);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    const token = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    return `ws_${token}`;
  };

  const handleExplorerFileClick = async (path: string) => {
    // Auto-load workflows directly from FileTree clicks.
    const lower = path.toLowerCase();
    const isWorkflowFile =
      lower.endsWith('.simple-steps-workflow') || lower.endsWith('.json');
    if (!isWorkflowFile || !rest.onLoadPipeline) return;

    const parts = path.split('/').filter(Boolean);
    if (parts.length < 1) return;

    const fileName = parts[parts.length - 1];
    const pipelineId = fileName
      .replace(/\.simple-steps-workflow$/i, '')
      .replace(/\.json$/i, '');

    let projectId: string;
    if (parts[0] === 'projects' && parts.length >= 3) {
      // projects/<project_id>/<pipeline>.json
      projectId = parts[1];
    } else {
      // Any other folder under workspace is a virtual workspace project.
      const relDir = parts.slice(0, -1).join('/');
      projectId = encodeWorkspaceProjectId(relDir);
    }

    try {
      await rest.onLoadPipeline(projectId, pipelineId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      window.alert(`Could not load workflow from ${path}: ${message}`);
    }
  };

  const titles: Record<string, string> = {
    explorer: 'Explorer',
    environment: 'Environment',
    docs: 'User Docs',
    settings: 'Settings',
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span>{titles[currentView ?? ''] ?? 'Explorer'}</span>
      </div>

      {currentView === 'explorer' && (
        <FileTree
          onFileClick={handleExplorerFileClick}
          onPipelineOpen={handleExplorerFileClick}
        />
      )}

      {currentView === 'environment' && (
        <EnvironmentExplorer workflowResources={rest.workflowResources} />
      )}

      {currentView === 'docs' && <DocsPanel />}

      {currentView === 'settings' && <SettingsPanel />}
    </div>
  );
};

export default Sidebar;

import React, { useState, useEffect, useCallback } from 'react';
import type { ActivityView } from './ActivityBar';
import type { ProjectInfo, PipelineFile, SimpleStepsSettings, OperationDefinition, ResourceDeclaration } from '../services/api';
import { fetchSettings, updateSettings } from '../services/api';
import FileTree from './FileTree';
import EnvironmentExplorer from './EnvironmentExplorer';
import DocsPanel from './DocsPanel';
import SymbolIcon from './SymbolIcon';
import { useStepPalette } from '../context/StepPaletteContext';
import { paletteColor } from '../styles/theme';
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
  /** Open the workspace file editor: on the explorer's toolbar. */
  onEditFiles?: () => void;
}

// ── Settings Panel ────────────────────────────────────────────────────────

const defaultSettings: SimpleStepsSettings = {
  result_store: 'memory',
  step_palette: '',
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
      setSettings({ ...s, result_store: s.result_store ?? 'memory' });
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
      setSettings({ ...next, result_store: next.result_store ?? 'memory' });
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

      <StepColorsCard />

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

/**
 * Step colours (owner, 2026-11-10): the palette that colours every step
 * without a colour of its own — the built-ins and the app's own
 * (App(step_palettes=…)), each shown as eight steps. The app's default is
 * App(step_palette=…); a choice here lasts until the server restarts.
 */
const StepColorsCard: React.FC = () => {
  const { name, palettes, choose } = useStepPalette();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="settings-card">
      <div className="settings-card-title">Step colours</div>
      <div className="step-palette-list" role="radiogroup" aria-label="Step colours">
        {Object.entries(palettes).map(([key, palette]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={key === name}
            className={`step-palette-option${key === name ? ' selected' : ''}`}
            onClick={() => { setError(null); choose(key).catch(() => setError('Could not change the step colours')); }}
          >
            <span className="step-palette-name">
              {key}
              <span className="step-palette-kind">{Array.isArray(palette) ? 'in turn' : 'gradient'}</span>
            </span>
            <span className="step-palette-preview" aria-hidden="true">
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} style={{ background: paletteColor(palette, i, 8) }} />
              ))}
            </span>
            {key === name && <SymbolIcon name="check" size={14} className="step-palette-check" />}
          </button>
        ))}
      </div>
      <span className="settings-help">
        Colours every step that has no colour of its own (a step's Settings can still set one).
      </span>
      {error && <div className="settings-error">{error}</div>}
    </div>
  );
};

// ── Main Sidebar ───────────────────────────────────────────────────────────

type View = Exclude<ActivityView, null>;

const Sidebar: React.FC<SidebarProps> = ({ isVisible, currentView, ...rest }) => {
  // Pinned panels stay open together, in the order pinned; each folds on its bar.
  const [pinned, setPinned] = useState<View[]>([]);
  const [folded, setFolded] = useState<Set<View>>(new Set());
  const togglePin = (view: View) => setPinned((p) => (p.includes(view) ? p.filter((v) => v !== view) : [...p, view]));
  const toggleFold = (view: View) => setFolded((f) => {
    const next = new Set(f);
    if (next.has(view)) next.delete(view); else next.add(view);
    return next;
  });
  // Choosing a pinned panel on the activity bar unfolds it.
  const [chosen, setChosen] = useState(currentView);
  if (chosen !== currentView) {
    setChosen(currentView);
    if (currentView && folded.has(currentView)) setFolded(new Set([...folded].filter((v) => v !== currentView)));
  }

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

  const titles: Record<View, string> = {
    explorer: 'Explorer',
    environment: 'Environment',
    docs: 'User Docs',
    settings: 'Settings',
  };

  const body = (view: View) => {
    switch (view) {
      case 'explorer': return (
        <>
          {/* The explorer's toolbar, above the root folder (owner, 2026-11-15). */}
          {rest.onEditFiles && (
            <div className="explorer-toolbar" role="toolbar" aria-label="Explorer">
              <button type="button" className="explorer-toolbar-btn" onClick={rest.onEditFiles}
                      title="Edit the workspace's files" data-testid="edit-files">
                <SymbolIcon name="edit" size={14} />
                <span>Edit Files</span>
              </button>
            </div>
          )}
          <FileTree onFileClick={handleExplorerFileClick} onPipelineOpen={handleExplorerFileClick} />
        </>
      );
      case 'environment': return <EnvironmentExplorer workflowResources={rest.workflowResources} />;
      case 'docs': return <DocsPanel />;
      case 'settings': return <SettingsPanel />;
    }
  };

  // The panels shown (owner, 2026-11-25): every pinned one, as a bar that
  // folds, and the activity bar's choice above them when it isn't pinned.
  const current = currentView ?? 'explorer';
  const shown: View[] = pinned.includes(current) ? pinned : [current, ...pinned];

  return (
    <div className="sidebar">
      {shown.map((view) => {
        const isPinned = pinned.includes(view);
        const open = !isPinned || !folded.has(view);
        return (
          <section key={view} className={`sidebar-panel${open ? ' open' : ''}${isPinned ? ' pinned' : ''}`}
                   data-testid={`sidebar-panel-${view}`}>
            <div className="sidebar-header sidebar-panel-bar">
              {isPinned ? (
                <button type="button" className="sidebar-panel-title" aria-expanded={open}
                        title={open ? 'Fold' : 'Unfold'} onClick={() => toggleFold(view)}>
                  <SymbolIcon name="chevron_right" size={14} className="sidebar-panel-caret" />
                  {titles[view]}
                </button>
              ) : (
                <span className="sidebar-panel-title">{titles[view]}</span>
              )}
              <button type="button" className={`sidebar-pin${isPinned ? ' on' : ''}`}
                      aria-pressed={isPinned}
                      title={isPinned ? 'Unpin: back to one panel at a time' : 'Pin: keep this panel open beside the others'}
                      aria-label={isPinned ? `Unpin ${titles[view]}` : `Pin ${titles[view]}`}
                      onClick={() => togglePin(view)}>
                <SymbolIcon name={isPinned ? 'keep_off' : 'push_pin'} size={14} />
              </button>
            </div>
            {open && <div className="sidebar-panel-body">{body(view)}</div>}
          </section>
        );
      })}
    </div>
  );
};

export default Sidebar;

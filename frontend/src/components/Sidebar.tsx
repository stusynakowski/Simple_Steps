import React, { useState, useEffect, useCallback } from 'react';
import Markdown from 'react-markdown';
import type { ActivityView } from './ActivityBar';
import type { ProjectInfo, PipelineFile, DeveloperPack, SimpleStepsSettings } from '../services/api';
import { fetchDeveloperPacks, readWorkspaceFile, fetchSettings, updateSettings } from '../services/api';
import FileTree from './FileTree';
import './Sidebar.css';

interface SidebarProps {
  isVisible: boolean;
  currentView: ActivityView;
  /** Increment to force the explorer to re-fetch projects/pipelines after a save */
  refreshTrigger?: number;
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

// ── Icons ──────────────────────────────────────────────────────────────────

const ChevronIcon = ({ collapsed }: { collapsed: boolean }) => (
  <span className={`chevron ${collapsed ? 'collapsed' : ''}`}>▼</span>
);
// ── User Docs Panel ────────────────────────────────────────────────────────

interface DocEntry {
  title: string;
  description: string;
  url: string;
}

const docSections: { category: string; docs: DocEntry[] }[] = [
  {
    category: 'Getting Started',
    docs: [
      {
        title: 'Getting Started',
        description: 'What the UI looks like, core concepts (steps, formulas, operations), and your first workflow.',
        url: '/usage_docs/getting-started.md',
      },
      {
        title: 'Projects & Saving',
        description: 'How projects and pipelines are organized, saving/loading workflows, and the file explorer.',
        url: '/usage_docs/projects-and-saving.md',
      },
    ],
  },
  {
    category: 'Using the App',
    docs: [
      {
        title: 'The Formula Bar',
        description: 'Formula syntax, step references (step1.url), eval mode, and how formulas get executed.',
        url: '/usage_docs/formula-bar.md',
      },
      {
        title: 'Operations & the Sidebar',
        description: 'Where operations come from (tiers 1-3), operation types, orchestration ops, and creating your own.',
        url: '/usage_docs/operations.md',
      },
      {
        title: 'Steps as Python Variables',
        description: 'StepProxy, ColumnProxy, auto-broadcasting — how steps work like Python objects.',
        url: '/usage_docs/step-variables.md',
      },
      {
        title: 'Helper Functions',
        description: 'map_each, apply_to, filter_by, expand_each, val, col — use any function with step broadcasting.',
        url: '/usage_docs/helpers.md',
      },
    ],
  },
  {
    category: 'Configuration',
    docs: [
      {
        title: 'Settings & Configuration',
        description: 'Eval mode, simple_steps.toml manifest, environment variables, and launch options.',
        url: '/usage_docs/settings.md',
      },
    ],
  },
  {
    category: 'Developer Guides',
    docs: [
      {
        title: 'Adding Operations',
        description: 'Create and register operations using @simple_step or register_operation.',
        url: '/usage_docs/developers/adding-operations.md',
      },
      {
        title: 'Creating Operation Packs',
        description: 'Bundle functions with dependency validation, health checks, and graceful degradation.',
        url: '/usage_docs/developers/creating-operation-packs.md',
      },
      {
        title: 'Managing Packs',
        description: 'Import packs from git/local/pip, the simple_steps.toml manifest, and the pack CLI.',
        url: '/usage_docs/developers/managing-packs.md',
      },
      {
        title: 'Desktop Mode',
        description: 'Run Simple Steps as a native desktop window with pywebview — no browser needed.',
        url: '/usage_docs/developers/desktop-mode.md',
      },
    ],
  },
];

const BookIcon = () => (
  <svg className="file-icon" width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
  </svg>
);

const DocsPanel: React.FC = () => {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    () => new Set(docSections.map(s => s.category))
  );
  const [activeDoc, setActiveDoc] = useState<DocEntry | null>(null);
  const [docContent, setDocContent] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(false);

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  const openDoc = async (doc: DocEntry) => {
    if (activeDoc?.url === doc.url) {
      // Toggle off
      setActiveDoc(null);
      setDocContent(null);
      return;
    }
    setActiveDoc(doc);
    setDocLoading(true);
    try {
      // url is like "/usage_docs/getting-started.md" — strip leading slash for the API
      const path = doc.url.startsWith('/') ? doc.url.slice(1) : doc.url;
      const result = await readWorkspaceFile(path);
      setDocContent(result.content ?? 'File too large to display.');
    } catch {
      setDocContent('Could not load document.');
    } finally {
      setDocLoading(false);
    }
  };

  // If a doc is open, show the reader view
  if (activeDoc && docContent !== null) {
    return (
      <div className="project-explorer" style={{ overflowY: 'auto', height: '100%' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => { setActiveDoc(null); setDocContent(null); }}
            style={{
              background: 'none', border: 'none', color: '#ccc', cursor: 'pointer',
              fontSize: '0.9rem', padding: '2px 6px',
            }}
            title="Back to docs list"
          >← Back</button>
          <span style={{ fontSize: '0.82rem', color: '#ccc', fontWeight: 600 }}>{activeDoc.title}</span>
        </div>
        <div className="docs-reader" style={{
          padding: '12px 16px', fontSize: '0.82rem', color: '#ccc', lineHeight: 1.6,
          overflowY: 'auto',
        }}>
          {docLoading ? <div style={{ color: '#888' }}>Loading…</div> : (
            <Markdown>{docContent}</Markdown>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="project-explorer" style={{ overflowY: 'auto' }}>
      {docSections.map(section => {
        const isOpen = expandedCategories.has(section.category);
        return (
          <div key={section.category} className="sidebar-section">
            <div
              className={`sidebar-section-title ${!isOpen ? 'collapsed' : ''}`}
              onClick={() => toggleCategory(section.category)}
            >
              <ChevronIcon collapsed={!isOpen} />
              <span>{section.category.toUpperCase()}</span>
            </div>
            {isOpen && (
              <div className="sidebar-content">
                {section.docs.map(doc => (
                  <div
                    key={doc.url}
                    className="docs-link-row"
                    title={doc.description}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                      padding: '6px 16px', cursor: 'pointer',
                    }}
                    onClick={() => openDoc(doc)}
                  >
                    <BookIcon />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.82rem', color: '#ccc' }}>{doc.title}</div>
                      <div style={{ fontSize: '0.72rem', color: '#888', lineHeight: 1.4, marginTop: 2 }}>
                        {doc.description}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Packs Panel ────────────────────────────────────────────────────────────

const PackIcon = () => (
  <svg className="file-icon" width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
    <line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
);

const FuncIcon = () => (
  <svg className="file-icon" width="12" height="12" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 18 22 12 16 6"/>
    <polyline points="8 6 2 12 8 18"/>
  </svg>
);

interface PacksPanelProps {
  refreshTrigger?: number;
}

// ── Settings Panel ────────────────────────────────────────────────────────

const defaultSettings: SimpleStepsSettings = {
  eval_mode: false,
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
        eval_mode: !!s.eval_mode,
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
        eval_mode: !!next.eval_mode,
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

        <label className="settings-toggle-row">
          <input
            type="checkbox"
            checked={settings.eval_mode}
            disabled={loading || saving}
            onChange={(e) => {
              void persist({ eval_mode: e.target.checked });
            }}
          />
          <span className="settings-label">Enable Eval Mode</span>
        </label>
        <div className="settings-help">
          Eval mode executes arbitrary Python from formulas. Keep this off in untrusted environments.
        </div>
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

const PacksPanel: React.FC<PacksPanelProps> = ({ refreshTrigger }) => {
  const [packs, setPacks] = useState<DeveloperPack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPacks, setExpandedPacks] = useState<Set<string>>(new Set());
  const [devPacksOpen, setDevPacksOpen] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDeveloperPacks();
      setPacks(data);
    } catch {
      setError('Could not load packs from backend');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (refreshTrigger === undefined || refreshTrigger === 0) return;
    refresh();
  }, [refreshTrigger, refresh]);

  const togglePack = (id: string) => {
    setExpandedPacks(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const totalOps = packs.reduce((sum, p) => sum + p.operations.length, 0);

  return (
    <div className="project-explorer" style={{ overflowY: 'auto' }}>
      {/* ── Developer Packs ──────────────────────────── */}
      <div className="sidebar-section">
        <div className={`sidebar-section-title ${!devPacksOpen ? 'collapsed' : ''}`}
          onClick={() => setDevPacksOpen(o => !o)}>
          <ChevronIcon collapsed={!devPacksOpen} />
          <span>DEVELOPER PACKS</span>
          <div className="section-actions">
            <button className="section-action-btn" title="Refresh packs"
              onClick={e => { e.stopPropagation(); refresh(); }}>↺</button>
          </div>
        </div>

        {devPacksOpen && (
          <div className="sidebar-content">
            {loading && <div className="sidebar-status">Loading…</div>}
            {error && <div className="sidebar-status sidebar-error">{error}</div>}
            {!loading && !error && packs.length === 0 && (
              <div className="sidebar-status sidebar-empty">
                No developer packs found.
                <span className="sidebar-hint">Place Python files in a packs/ directory.</span>
              </div>
            )}

            {packs.filter(p => p.operations.length > 0).map(pack => {
              const isOpen = expandedPacks.has(pack.id);
              return (
                <div key={pack.id} className="project-folder">
                  <div className={`folder-row ${isOpen ? 'open' : ''}`}
                    onClick={() => togglePack(pack.id)}>
                    <span className={`chevron ${!isOpen ? 'collapsed' : ''}`} style={{ fontSize: '0.6rem' }}>▼</span>
                    <PackIcon />
                    <span className="file-label">{pack.name}</span>
                    <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: '#888', paddingRight: 8 }}>
                      {pack.operations.length} ops
                    </span>
                  </div>

                  {isOpen && (
                    <div className="pipeline-list">
                      {pack.operations.map(opId => (
                        <div key={opId} className="file-item" style={{ paddingLeft: 36, cursor: 'default' }}>
                          <FuncIcon />
                          <span className="file-label" style={{ fontSize: '0.8rem' }}>{opId}</span>
                        </div>
                      ))}
                      {pack.errors.length > 0 && pack.errors.map((err, i) => (
                        <div key={`err-${i}`} className="file-item" style={{ paddingLeft: 36, color: '#f44', fontSize: '0.75rem' }}>
                          ⚠ {err}
                        </div>
                      ))}
                      <div style={{ paddingLeft: 36, fontSize: '0.7rem', color: '#666', padding: '4px 8px 4px 36px' }}>
                        {pack.path}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {!loading && !error && packs.length > 0 && (
              <div style={{ padding: '8px 15px', fontSize: '0.72rem', color: '#666', borderTop: '1px solid #2a2a2a' }}>
                {packs.filter(p => p.operations.length > 0).length} pack(s) · {totalOps} operations loaded
              </div>
            )}
          </div>
        )}
      </div>
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
    explorer: 'Explorer', search: 'Search',
    docs: 'User Docs', packs: 'Operation Packs',
    settings: 'Settings', account: 'Account',
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span>{titles[currentView ?? ''] ?? 'Explorer'}</span>
      </div>

      {currentView === 'explorer' && (
        <FileTree onFileClick={handleExplorerFileClick} />
      )}

      {currentView === 'search' && (
        <div className="sidebar-padding">
          <input type="text" placeholder="Search…"
            style={{ width: '90%', margin: '10px 5%', padding: '5px',
              background: '#252526', border: '1px solid #3c3c3c', color: '#fff' }} />
          <div style={{ marginTop: 10, marginLeft: '5%', color: '#888', fontSize: '0.9em' }}>
            No results found.
          </div>
        </div>
      )}

      {currentView === 'docs' && <DocsPanel />}

      {currentView === 'packs' && <PacksPanel refreshTrigger={rest.refreshTrigger} />}

      {currentView === 'settings' && <SettingsPanel />}

      {currentView === 'account' && (
        <div className="sidebar-padding" style={{ color: '#888', fontStyle: 'italic', padding: 20 }}>
          User Profiles
        </div>
      )}
    </div>
  );
};

export default Sidebar;

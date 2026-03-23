import React, { useState, useEffect, useCallback } from 'react';
import type { ActivityView } from './ActivityBar';
import type { ProjectInfo, PipelineFile, OperationDefinition } from '../services/api';
import type { Workflow } from '../types/models';
import { youtubeAnalysisPipeline } from '../mocks/initialData';
import { checkBackendStatus } from '../services/api';
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
  onLoadWorkflowObject?: (wf: Workflow) => void;
  /** Available operations from the backend registry */
  availableOperations?: OperationDefinition[];
}

// ── Icons ──────────────────────────────────────────────────────────────────

const PipelineIcon = () => (
  <svg className="file-icon" width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
  </svg>
);

const FolderIcon = ({ open }: { open: boolean }) => (
  <svg className="folder-icon" width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {open
      ? <><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="2" y1="10" x2="22" y2="10"/></>
      : <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>}
  </svg>
);

const ChevronIcon = ({ collapsed }: { collapsed: boolean }) => (
  <span className={`chevron ${collapsed ? 'collapsed' : ''}`}>▼</span>
);

const TrashIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14H6L5 6"/>
    <path d="M10 11v6M14 11v6"/>
    <path d="M9 6V4h6v2"/>
  </svg>
);

// ── ProjectTree ────────────────────────────────────────────────────────────

interface ProjectTreeProps {
  onListProjects?: () => Promise<ProjectInfo[]>;
  onCreateProject?: (name: string) => Promise<ProjectInfo>;
  onDeleteProject?: (id: string) => Promise<void>;
  onListPipelines?: (projectId: string) => Promise<PipelineFile[]>;
  onLoadPipeline?: (projectId: string, pipelineId: string) => Promise<void>;
  onRequestSave?: (projectId: string, projectDisplayName: string) => void;
  onDeletePipeline?: (projectId: string, pipelineId: string) => Promise<void>;
  refreshTrigger?: number;
}

const ProjectTree: React.FC<ProjectTreeProps> = ({
  onListProjects, onCreateProject, onDeleteProject,
  onListPipelines, onLoadPipeline, onRequestSave, onDeletePipeline,
  refreshTrigger,
}) => {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which project folders are expanded
  const [openProjects, setOpenProjects] = useState<Set<string>>(new Set());
  // Cached pipeline lists per project
  const [pipelinesMap, setPipelinesMap] = useState<Record<string, PipelineFile[]>>({});
  const [loadingPipelines, setLoadingPipelines] = useState<Set<string>>(new Set());

  // Active selection
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Pending single-click confirm for deletes
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  // Demo section
  const [projectsOpen, setProjectsOpen] = useState(true);

  const refresh = useCallback(async () => {
    if (!onListProjects) return;
    setLoading(true); setError(null);
    try { setProjects(await onListProjects()); }
    catch { setError('Could not reach backend'); }
    finally { setLoading(false); }
  }, [onListProjects]);

  useEffect(() => { refresh(); }, [refresh]);

  // Re-fetch when parent signals a save has happened
  useEffect(() => {
    if (refreshTrigger === undefined || refreshTrigger === 0) return;
    refresh().then(() => {
      // Also refresh any currently-open project folders
      openProjects.forEach(projectId => loadPipelinesForProject(projectId));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  const loadPipelinesForProject = useCallback(async (projectId: string) => {
    if (!onListPipelines) return;
    setLoadingPipelines(prev => new Set(prev).add(projectId));
    try {
      const pipes = await onListPipelines(projectId);
      setPipelinesMap(prev => ({ ...prev, [projectId]: pipes }));
    } finally {
      setLoadingPipelines(prev => { const s = new Set(prev); s.delete(projectId); return s; });
    }
  }, [onListPipelines]);

  const toggleProject = useCallback((projectId: string) => {
    setOpenProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) { next.delete(projectId); }
      else {
        next.add(projectId);
        if (!pipelinesMap[projectId]) loadPipelinesForProject(projectId);
      }
      return next;
    });
  }, [pipelinesMap, loadPipelinesForProject]);

  const handleCreateProject = async () => {
    if (!onCreateProject) return;
    const name = prompt('New project name:');
    if (!name?.trim()) return;
    await onCreateProject(name.trim());
    await refresh();
  };

  const handleDeleteProject = async (id: string) => {
    if (!onDeleteProject) return;
    const key = `proj:${id}`;
    if (confirmKey !== key) { setConfirmKey(key); return; }
    setConfirmKey(null);
    await onDeleteProject(id);
    await refresh();
  };

  const handleSavePipeline = (projectId: string, projectDisplayName: string) => {
    onRequestSave?.(projectId, projectDisplayName);
  };

  const handleLoadPipeline = async (projectId: string, pipelineId: string) => {
    if (!onLoadPipeline) return;
    setActiveKey(`pipe:${projectId}:${pipelineId}`);
    await onLoadPipeline(projectId, pipelineId);
  };

  const handleDeletePipeline = async (projectId: string, pipelineId: string) => {
    if (!onDeletePipeline) return;
    const key = `pipe:${projectId}:${pipelineId}`;
    if (confirmKey !== key) { setConfirmKey(key); return; }
    setConfirmKey(null);
    await onDeletePipeline(projectId, pipelineId);
    await loadPipelinesForProject(projectId);
  };

  return (
    <div className="project-explorer">

      {/* ── Saved Projects ──────────────────────────────── */}
      <div className="sidebar-section">
        <div className={`sidebar-section-title ${!projectsOpen ? 'collapsed' : ''}`}
          onClick={() => setProjectsOpen(o => !o)}>
          <ChevronIcon collapsed={!projectsOpen} />
          <span>PROJECTS</span>
          <div className="section-actions">
            <button className="section-action-btn" title="New project folder"
              onClick={e => { e.stopPropagation(); handleCreateProject(); }}>+</button>
            <button className="section-action-btn" title="Refresh"
              onClick={e => { e.stopPropagation(); refresh(); }}>↺</button>
          </div>
        </div>

        {projectsOpen && (
          <div className="sidebar-content">
            {loading && <div className="sidebar-status">Loading…</div>}
            {error   && <div className="sidebar-status sidebar-error">{error}</div>}
            {!loading && !error && projects.length === 0 && (
              <div className="sidebar-status sidebar-empty">
                No projects yet.
                <span className="sidebar-hint">Click + to create a project folder.</span>
              </div>
            )}

            {projects.map(proj => {
              const isOpen = openProjects.has(proj.id);
              const pipes  = pipelinesMap[proj.id] ?? [];
              const isLoadingPipes = loadingPipelines.has(proj.id);
              const projConfirmKey = `proj:${proj.id}`;

              return (
                <div key={proj.id} className="project-folder">
                  {/* Project row */}
                  <div className={`folder-row ${isOpen ? 'open' : ''}`}
                    onClick={() => toggleProject(proj.id)}>
                    <span className={`chevron ${!isOpen ? 'collapsed' : ''}`} style={{fontSize:'0.6rem'}}>▼</span>
                    <FolderIcon open={isOpen} />
                    <span className="file-label">{proj.name}</span>
                    <div className="section-actions">
                      <button className="section-action-btn" title="Save current pipeline here"
                        onClick={e => { e.stopPropagation(); handleSavePipeline(proj.id, proj.name); }}>💾</button>
                      <button
                        className={`file-delete-btn ${confirmKey === projConfirmKey ? 'confirm' : ''}`}
                        title={confirmKey === projConfirmKey ? 'Click again to confirm' : 'Delete project'}
                        onClick={e => { e.stopPropagation(); handleDeleteProject(proj.id); }}>
                        {confirmKey === projConfirmKey ? '✓' : <TrashIcon />}
                      </button>
                    </div>
                  </div>

                  {/* Pipeline list */}
                  {isOpen && (
                    <div className="pipeline-list">
                      {isLoadingPipes && <div className="sidebar-status" style={{paddingLeft:36}}>Loading…</div>}
                      {!isLoadingPipes && pipes.length === 0 && (
                        <div className="sidebar-status" style={{paddingLeft:36}}>
                          No pipelines — click 💾 to save one.
                        </div>
                      )}
                      {pipes.map(pipe => {
                        const pipeKey = `pipe:${proj.id}:${pipe.id}`;
                        return (
                          <div key={pipe.id}
                            className={`file-item pipeline-item ${activeKey === pipeKey ? 'active' : ''}`}
                            onClick={() => handleLoadPipeline(proj.id, pipe.id)}
                            title={`Updated: ${pipe.updated_at ? new Date(pipe.updated_at).toLocaleString() : '—'}`}>
                            <PipelineIcon />
                            <span className="file-label">{pipe.name}.json</span>
                            <button
                              className={`file-delete-btn ${confirmKey === pipeKey ? 'confirm' : ''}`}
                              title={confirmKey === pipeKey ? 'Click again to confirm' : 'Delete pipeline'}
                              onClick={e => { e.stopPropagation(); handleDeletePipeline(proj.id, pipe.id); }}>
                              {confirmKey === pipeKey ? '✓' : <TrashIcon />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Resources & Registry Panel ─────────────────────────────────────────────

const PlayIcon = () => (
  <svg className="file-icon" width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3"/>
  </svg>
);

const FnIcon = () => (
  <svg className="file-icon" width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 17 10 11 4 5"/>
    <line x1="12" y1="19" x2="20" y2="19"/>
  </svg>
);

const ResourceIcon = () => (
  <svg className="file-icon" width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3"/>
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
  </svg>
);

// Type badge colors
const typeBadgeColors: Record<string, string> = {
  source: '#4ec9b0',
  map: '#569cd6',
  filter: '#ce9178',
  dataframe: '#b5cea8',
  expand: '#d7ba7d',
  raw_output: '#c586c0',
  orchestrator: '#9cdcfe',
};

interface ResourcesPanelProps {
  onLoadWorkflowObject?: (wf: Workflow) => void;
  availableOperations?: OperationDefinition[];
}

const demos: { label: string; description: string; wf: Workflow }[] = [
  {
    label: 'YouTube Channel Analysis',
    description: 'Fetches videos, extracts metadata, transcribes, segments, analyzes sentiment, and generates a report.',
    wf: youtubeAnalysisPipeline,
  },
];

const ResourcesPanel: React.FC<ResourcesPanelProps> = ({ onLoadWorkflowObject, availableOperations = [] }) => {
  const [resourcesOpen, setResourcesOpen] = useState(true);
  const [registryOpen, setRegistryOpen] = useState(true);
  const [demosOpen, setDemosOpen] = useState(true);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedOps, setExpandedOps] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState('');

  // Check backend status on mount
  useEffect(() => {
    checkBackendStatus().then(setBackendOnline);
    const interval = setInterval(() => {
      checkBackendStatus().then(setBackendOnline);
    }, 30_000); // re-check every 30s
    return () => clearInterval(interval);
  }, []);

  // Group operations by category
  const filtered = filterText
    ? availableOperations.filter(op =>
        op.id.toLowerCase().includes(filterText.toLowerCase()) ||
        op.label.toLowerCase().includes(filterText.toLowerCase()) ||
        op.category.toLowerCase().includes(filterText.toLowerCase()))
    : availableOperations;

  const grouped = filtered.reduce<Record<string, OperationDefinition[]>>((acc, op) => {
    const cat = op.category || 'Uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(op);
    return acc;
  }, {});

  const sortedCategories = Object.keys(grouped).sort();

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  const toggleOp = (id: string) => {
    setExpandedOps(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="project-explorer">

      {/* ── Resources (APIs / Services) ──────────────────── */}
      <div className="sidebar-section">
        <div className={`sidebar-section-title ${!resourcesOpen ? 'collapsed' : ''}`}
          onClick={() => setResourcesOpen(o => !o)}>
          <ChevronIcon collapsed={!resourcesOpen} />
          <span>RESOURCES</span>
        </div>
        {resourcesOpen && (
          <div className="sidebar-content">
            {/* Backend status */}
            <div className="resource-row">
              <span className={`resource-status-dot ${backendOnline === true ? 'online' : backendOnline === false ? 'offline' : 'checking'}`} />
              <span className="resource-label">Backend Engine</span>
              <span className="resource-status-text">
                {backendOnline === null ? 'checking…' : backendOnline ? 'online' : 'offline'}
              </span>
            </div>

            {/* Placeholder for future resources */}
            <div className="resource-empty-hint">
              <ResourceIcon />
              <span>No external APIs or services configured yet.</span>
            </div>
            <div className="resource-empty-subhint">
              Resources like API keys, database connections, and external services will appear here as they are added.
            </div>
          </div>
        )}
      </div>

      {/* ── Function Registry ────────────────────────────── */}
      <div className="sidebar-section">
        <div className={`sidebar-section-title ${!registryOpen ? 'collapsed' : ''}`}
          onClick={() => setRegistryOpen(o => !o)}>
          <ChevronIcon collapsed={!registryOpen} />
          <span>FUNCTION REGISTRY</span>
          <div className="section-actions">
            <span className="registry-count-badge">{availableOperations.length}</span>
          </div>
        </div>
        {registryOpen && (
          <div className="sidebar-content">
            {/* Filter */}
            <div className="registry-filter-row">
              <input
                type="text"
                className="registry-filter-input"
                placeholder="Filter functions…"
                value={filterText}
                onChange={e => setFilterText(e.target.value)}
              />
              {filterText && (
                <button className="registry-filter-clear" onClick={() => setFilterText('')}>×</button>
              )}
            </div>

            {availableOperations.length === 0 && (
              <div className="sidebar-status" style={{ paddingLeft: 16 }}>
                {backendOnline === false
                  ? 'Backend offline — cannot load functions.'
                  : 'Loading functions…'}
              </div>
            )}

            {filtered.length === 0 && availableOperations.length > 0 && (
              <div className="sidebar-status" style={{ paddingLeft: 16 }}>No matches.</div>
            )}

            {sortedCategories.map(cat => {
              const ops = grouped[cat];
              const isCatOpen = expandedCategories.has(cat);
              return (
                <div key={cat} className="registry-category">
                  <div className="registry-category-row" onClick={() => toggleCategory(cat)}>
                    <span className={`chevron ${!isCatOpen ? 'collapsed' : ''}`} style={{ fontSize: '0.6rem' }}>▼</span>
                    <span className="registry-category-label">{cat}</span>
                    <span className="registry-category-count">{ops.length}</span>
                  </div>
                  {isCatOpen && (
                    <div className="registry-ops-list">
                      {ops.map(op => {
                        const isOpOpen = expandedOps.has(op.id);
                        return (
                          <div key={op.id} className="registry-op">
                            <div className="registry-op-row" onClick={() => toggleOp(op.id)}>
                              <FnIcon />
                              <span className="registry-op-label">{op.label}</span>
                              <span className="registry-type-badge" style={{ background: typeBadgeColors[op.type] || '#666' }}>
                                {op.type}
                              </span>
                            </div>
                            {isOpOpen && (
                              <div className="registry-op-detail">
                                <div className="registry-op-id">
                                  <code>{op.id}</code>
                                </div>
                                {op.description && (
                                  <div className="registry-op-desc">{op.description}</div>
                                )}
                                {op.params.length > 0 && (
                                  <div className="registry-op-params">
                                    <div className="registry-params-title">Parameters</div>
                                    {op.params.map(p => (
                                      <div key={p.name} className="registry-param-row">
                                        <code className="registry-param-name">{p.name}</code>
                                        <span className="registry-param-type">{p.type}</span>
                                        {p.default !== undefined && p.default !== null && (
                                          <span className="registry-param-default">= {JSON.stringify(p.default)}</span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {op.params.length === 0 && (
                                  <div className="registry-op-desc" style={{ fontStyle: 'italic' }}>No parameters</div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Demo Pipelines ──────────────────────────────── */}
      <div className="sidebar-section">
        <div className={`sidebar-section-title ${!demosOpen ? 'collapsed' : ''}`}
          onClick={() => setDemosOpen(o => !o)}>
          <ChevronIcon collapsed={!demosOpen} />
          <span>DEMO PIPELINES</span>
        </div>
        {demosOpen && (
          <div className="sidebar-content">
            {demos.map(d => (
              <div key={d.label} className="demo-card" title={d.description}>
                <div className="demo-card-header">
                  <PlayIcon />
                  <span className="file-label">{d.label}</span>
                </div>
                <div className="demo-card-description">{d.description}</div>
                <button
                  className="demo-load-btn"
                  onClick={() => onLoadWorkflowObject?.(d.wf)}
                >
                  ▶ Load Pipeline
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Main Sidebar ───────────────────────────────────────────────────────────

const Sidebar: React.FC<SidebarProps> = ({ isVisible, currentView, onLoadWorkflowObject, availableOperations, ...rest }) => {
  if (!isVisible) return null;

  const titles: Record<string, string> = {
    explorer: 'Explorer', search: 'Search',
    components: 'Components', demos: 'Resources',
    settings: 'Settings', account: 'Account',
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span>{titles[currentView ?? ''] ?? 'Explorer'}</span>
      </div>

      {currentView === 'explorer' && <ProjectTree {...rest} />}

      {currentView === 'demos' && (
        <ResourcesPanel
          onLoadWorkflowObject={onLoadWorkflowObject}
          availableOperations={availableOperations}
        />
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

      {currentView === 'components' && (
        <div className="sidebar-padding" style={{ padding: 10 }}>
          <div className="sidebar-section-title" style={{ paddingLeft: 0 }}><span>INSTALLED</span></div>
          <div className="file-item"><span>Agent Widget</span></div>
          <div className="file-item"><span>Data Grid</span></div>
          <div className="sidebar-section-title" style={{ paddingLeft: 0, marginTop: 20 }}><span>RECOMMENDED</span></div>
          <div className="file-item"><span>Graph Viz</span></div>
        </div>
      )}

      {(currentView === 'settings' || currentView === 'account') && (
        <div className="sidebar-padding" style={{ color: '#888', fontStyle: 'italic', padding: 20 }}>
          {currentView === 'settings' ? 'Global Settings' : 'User Profiles'}
        </div>
      )}
    </div>
  );
};

export default Sidebar;

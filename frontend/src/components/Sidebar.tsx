import React, { useState, useEffect, useCallback } from 'react';
import type { ActivityView } from './ActivityBar';
import type { ProjectInfo, PipelineFile } from '../services/api';
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
        title: 'Introduction',
        description: 'Overview of Simple Steps and core concepts.',
        url: '/docs/introduction.md',
      },
    ],
  },
  {
    category: 'Developer Guides',
    docs: [
      {
        title: 'Adding Operations',
        description: 'How to create and register operations using the @simple_step decorator.',
        url: '/usage_docs/developers/adding-operations.md',
      },
      {
        title: 'Creating Operation Packs',
        description: 'Bundle related functions with dependency validation and health checks.',
        url: '/usage_docs/developers/creating-operation-packs.md',
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

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

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
                  <a
                    key={doc.url}
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="docs-link-row"
                    title={doc.description}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                      padding: '6px 16px', textDecoration: 'none', color: 'inherit',
                      cursor: 'pointer',
                    }}
                    onClick={e => {
                      e.preventDefault();
                      window.open(doc.url, '_blank');
                    }}
                  >
                    <BookIcon />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.82rem', color: '#ccc' }}>{doc.title}</div>
                      <div style={{ fontSize: '0.72rem', color: '#888', lineHeight: 1.4, marginTop: 2 }}>
                        {doc.description}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Main Sidebar ───────────────────────────────────────────────────────────

const Sidebar: React.FC<SidebarProps> = ({ isVisible, currentView, ...rest }) => {
  if (!isVisible) return null;

  const titles: Record<string, string> = {
    explorer: 'Explorer', search: 'Search',
    docs: 'User Docs',
    settings: 'Settings', account: 'Account',
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span>{titles[currentView ?? ''] ?? 'Explorer'}</span>
      </div>

      {currentView === 'explorer' && <ProjectTree {...rest} />}

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

      {(currentView === 'settings' || currentView === 'account') && (
        <div className="sidebar-padding" style={{ color: '#888', fontStyle: 'italic', padding: 20 }}>
          {currentView === 'settings' ? 'Global Settings' : 'User Profiles'}
        </div>
      )}
    </div>
  );
};

export default Sidebar;

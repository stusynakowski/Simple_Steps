import { useState, useCallback, useRef, useEffect } from 'react';
import WorkflowTabs, { type WorkflowTab } from './WorkflowTabs';
import GlobalControls from './GlobalControls';
import OperationColumn from './OperationColumn';
import useWorkflow from '../hooks/useWorkflow';
import { getStepColor } from '../styles/theme';
import Sidebar from './Sidebar';
import ChatSidebar from './ChatSidebar';
import ActivityBar from './ActivityBar';
import MenuBar from './MenuBar';
import SaveModal from './SaveModal';
import RenameModal from './RenameModal';
import type { ActivityView } from './ActivityBar';
import type { Workflow } from '../types/models';
import { initialWorkflow } from '../mocks/initialData';
import { StepWiringProvider } from '../context/StepWiringContext';
import './MainLayout.css';

// ── Types ──────────────────────────────────────────────────────────────────

interface OpenTab extends WorkflowTab {
  projectId?: string;          // undefined = unsaved / demo
  projectDisplayName?: string; // human-readable project name for breadcrumb
  pipelineId?: string;
  workflow: Workflow;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function MainLayout() {
  const [headerHeight, setHeaderHeight] = useState(200);
  const [sidebarWidth, setSidebarWidth] = useState(250);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(300);
  const [activeActivityView, setActiveActivityView] = useState<ActivityView>('explorer');
  const [isDragging, setIsDragging] = useState(false);

  const isResizingHeader = useRef(false);
  const isResizingSidebar = useRef(false);
  const isResizingRightSidebar = useRef(false);
  const lastRightSidebarWidth = useRef(300);
  const lastSidebarWidth = useRef(250);
  const lastHeaderHeight = useRef(200);

  const {
    workflow,
    availableOperations,
    expandedStepIds,
    pipelineStatus,
    maximizedStepId,
    addStepAt,
    toggleStep,
    toggleMaximizeStep,
    collapseStep,
    updateStep,
    runStep,
    runPipeline,
    pausePipeline,
    stopPipeline,
    previewStep,
    deleteStep,
    saveWorkflow,
    fetchWorkflow,
    loadWorkflowObject,
    listSavedProjects,
    createNewProject,
    removeProject,
    listProjectPipelines,
    removePipeline,
  } = useWorkflow();

  // ── Tab state ────────────────────────────────────────────────────────────
  // Start with the initial workflow as the first tab
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([
    { id: 'initial', title: initialWorkflow.name, isActive: true, workflow: initialWorkflow },
  ]);

  const activeTab = openTabs.find(t => t.isActive) ?? openTabs[0];
  const projectName = activeTab?.projectDisplayName ?? activeTab?.projectId ?? '';

  // Suppress isModified when we're switching tabs / loading (not user edits)
  const suppressModified = useRef(false);

  // ── Save / Rename modal state ─────────────────────────────────────────
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveAsMode, setSaveAsMode] = useState(false); // true = always show picker
  const [renameModalOpen, setRenameModalOpen] = useState(false);

  /** Save: if the tab already has a project+pipeline, overwrite silently; otherwise open modal. */
  const handleSave = useCallback(async () => {
    if (activeTab?.projectId && activeTab?.pipelineId) {
      try {
        // Re-save using the existing pipeline name (id == slug == name-derived)
        suppressModified.current = true;
        await saveWorkflow(activeTab.projectId, activeTab.workflow.name || activeTab.pipelineId);
        setOpenTabs(prev => prev.map(t => t.isActive ? { ...t, isModified: false } : t));
      } catch (e) {
        console.error('Save failed', e);
        setSaveAsMode(false);
        setSaveModalOpen(true);
      } finally {
        suppressModified.current = false;
      }
    } else {
      setSaveAsMode(false);
      setSaveModalOpen(true);
    }
  }, [activeTab, saveWorkflow]);

  const handleSaveAs = useCallback(() => {
    setSaveAsMode(true);
    setSaveModalOpen(true);
  }, []);

  const handleModalSave = useCallback(async (projectId: string, pipelineName: string, projectDisplayName?: string) => {
    suppressModified.current = true;
    try {
      const saved = await saveWorkflow(projectId, pipelineName);
      // saved.id is now the slug derived from pipelineName, matching the filename on disk
      setOpenTabs(prev => prev.map(t => {
        if (!t.isActive) return t;
        return {
          ...t,
          id: `${projectId}::${saved.id}`,
          title: `${pipelineName}.json`,
          projectId,
          projectDisplayName: projectDisplayName ?? projectId,
          pipelineId: saved.id,
          isModified: false,
          workflow: { ...t.workflow, name: pipelineName },
        };
      }));
      // Tell sidebar to refresh so the new file appears
      setSidebarRefreshTrigger(n => n + 1);
    } finally {
      suppressModified.current = false;
    }
  }, [saveWorkflow]);

  const handleRename = useCallback((newName: string) => {
    // Update workflow name in state + mark tab title
    setOpenTabs(prev => prev.map(t => {
      if (!t.isActive) return t;
      return { ...t, title: `${newName}.json`, isModified: true };
    }));
    // Also update the in-memory workflow name via loadWorkflowObject with new name
    loadWorkflowObject({ ...workflow, name: newName });
  }, [workflow, loadWorkflowObject]);

  // ── Cmd/Ctrl+S shortcut ───────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (e.shiftKey) handleSaveAs();
        else handleSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave, handleSaveAs]);

  /** Open or focus a pipeline tab, loading the workflow into the hook. */
  const openPipelineTab = useCallback(async (projectId: string, pipelineId: string) => {
    const tabKey = `${projectId}::${pipelineId}`;
    const existing = openTabs.find(t => t.id === tabKey);
    if (existing) {
      setOpenTabs(prev => prev.map(t => ({ ...t, isActive: t.id === tabKey })));
      suppressModified.current = true;
      loadWorkflowObject(existing.workflow);
      setTimeout(() => { suppressModified.current = false; }, 0);
      return;
    }
    // Fetch and open new tab
    const wf = await fetchWorkflow(projectId, pipelineId);
    // Get project display name from existing projects list
    const newTab: OpenTab = {
      id: tabKey,
      title: `${wf.name}.json`,
      isActive: true,
      projectId,
      projectDisplayName: projectId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      pipelineId,
      workflow: wf,
    };
    setOpenTabs(prev => [
      ...prev.map(t => ({ ...t, isActive: false })),
      newTab,
    ]);
    suppressModified.current = true;
    loadWorkflowObject(wf);
    setTimeout(() => { suppressModified.current = false; }, 0);
  }, [openTabs, fetchWorkflow, loadWorkflowObject]);

  /** Open a demo / in-memory workflow as a tab. */
  const openWorkflowObjectTab = useCallback((wf: Workflow) => {
    const tabKey = `demo::${wf.id}`;
    const existing = openTabs.find(t => t.id === tabKey);
    if (existing) {
      setOpenTabs(prev => prev.map(t => ({ ...t, isActive: t.id === tabKey })));
      loadWorkflowObject(existing.workflow);
      return;
    }
    const newTab: OpenTab = {
      id: tabKey,
      title: `${wf.name}.json`,
      isActive: true,
      workflow: wf,
    };
    setOpenTabs(prev => [
      ...prev.map(t => ({ ...t, isActive: false })),
      newTab,
    ]);
    loadWorkflowObject(wf);
  }, [openTabs, loadWorkflowObject]);

  const handleTabClick = useCallback((id: string) => {
    const tab = openTabs.find(t => t.id === id);
    if (!tab) return;
    setOpenTabs(prev => prev.map(t => ({ ...t, isActive: t.id === id })));
    suppressModified.current = true;
    loadWorkflowObject(tab.workflow);
    setTimeout(() => { suppressModified.current = false; }, 0);
  }, [openTabs, loadWorkflowObject]);

  const handleTabClose = useCallback((id: string) => {
    if (openTabs.length <= 1) return;
    const closingActive = openTabs.find(t => t.id === id)?.isActive;
    const next = openTabs.filter(t => t.id !== id);
    if (closingActive) {
      next[next.length - 1].isActive = true;
      loadWorkflowObject(next[next.length - 1].workflow);
    }
    setOpenTabs(next);
  }, [openTabs, loadWorkflowObject]);

  const handleNewTab = useCallback(() => {
    const blank: Workflow = {
      id: `new-${Date.now()}`,
      name: 'Untitled',
      created_at: new Date().toISOString(),
      steps: [],
    };
    const newTab: OpenTab = {
      id: blank.id,
      title: 'Untitled.json',
      isActive: true,
      workflow: blank,
    };
    setOpenTabs(prev => [
      ...prev.map(t => ({ ...t, isActive: false })),
      newTab,
    ]);
    loadWorkflowObject(blank);
  }, [loadWorkflowObject]);

  // Keep the active tab's workflow snapshot in sync when the hook's workflow changes
  // (e.g. after a step edit or run) — but don't mark dirty during tab switches/saves
  useEffect(() => {
    if (suppressModified.current) return;
    setOpenTabs(prev => prev.map(t =>
      t.isActive ? { ...t, workflow, isModified: true } : t
    ));
  }, [workflow]);

  // ── Resize logic ─────────────────────────────────────────────────────────

  const startResizingHeader = useCallback(() => {
    isResizingHeader.current = true; setIsDragging(true);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const toggleHeader = useCallback(() => {
    if (headerHeight > 60) { lastHeaderHeight.current = headerHeight; setHeaderHeight(44); }
    else setHeaderHeight(lastHeaderHeight.current > 60 ? lastHeaderHeight.current : 200);
  }, [headerHeight]);

  const startResizingSidebar = useCallback(() => {
    isResizingSidebar.current = true; setIsDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const toggleSidebar = useCallback(() => {
    if (sidebarWidth > 20) { lastSidebarWidth.current = sidebarWidth; setSidebarWidth(0); }
    else setSidebarWidth(lastSidebarWidth.current > 20 ? lastSidebarWidth.current : 250);
  }, [sidebarWidth]);

  const startResizingRightSidebar = useCallback(() => {
    isResizingRightSidebar.current = true; setIsDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const stopResizing = useCallback(() => {
    isResizingHeader.current = false;
    isResizingSidebar.current = false;
    isResizingRightSidebar.current = false;
    setIsDragging(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const resize = useCallback((e: MouseEvent) => {
    if (isResizingHeader.current) {
      const h = Math.max(44, Math.min(e.clientY, 600));
      setHeaderHeight(h);
      if (h > 60) lastHeaderHeight.current = h;
    }
    if (isResizingSidebar.current) {
      const w = Math.max(0, Math.min(e.clientX, 500));
      setSidebarWidth(w);
      if (w > 50) lastSidebarWidth.current = w;
    }
    if (isResizingRightSidebar.current) {
      const w = Math.max(0, Math.min(window.innerWidth - e.clientX, 600));
      setRightSidebarWidth(w);
      if (w > 50) lastRightSidebarWidth.current = w;
    }
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [resize, stopResizing]);

  const handleViewChange = (view: ActivityView) => {
    if (view === activeActivityView) {
      if (sidebarWidth > 0) { lastSidebarWidth.current = sidebarWidth; setSidebarWidth(0); }
      else setSidebarWidth(lastSidebarWidth.current > 20 ? lastSidebarWidth.current : 250);
    } else {
      setActiveActivityView(view);
      if (sidebarWidth === 0) setSidebarWidth(lastSidebarWidth.current > 20 ? lastSidebarWidth.current : 250);
    }
  };

  const toggleChat = () => {
    if (rightSidebarWidth > 20) { lastRightSidebarWidth.current = rightSidebarWidth; setRightSidebarWidth(0); }
    else setRightSidebarWidth(lastRightSidebarWidth.current > 20 ? lastRightSidebarWidth.current : 300);
  };

  const transitionStyle = isDragging ? 'none'
    : 'width 0.3s cubic-bezier(0.4,0,0.2,1), height 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.3s cubic-bezier(0.4,0,0.2,1)';

  // ── Sidebar refresh trigger ────────────────────────────────────────────
  const [sidebarRefreshTrigger, setSidebarRefreshTrigger] = useState(0);

  // Pre-selected project when opening SaveModal from sidebar's 💾 button
  const [preselectProjectId, setPreselectProjectId] = useState<string | undefined>();
  const [preselectProjectName, setPreselectProjectName] = useState<string | undefined>();

  const handleRequestSaveFromSidebar = useCallback((projectId: string, projectDisplayName: string) => {
    setPreselectProjectId(projectId);
    setPreselectProjectName(projectDisplayName);
    setSaveAsMode(false);
    setSaveModalOpen(true);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="main-layout" data-testid="main-layout">
      <ActivityBar activeView={activeActivityView} onViewChange={handleViewChange} />

      {/* Left sidebar */}
      <div style={{
        width: sidebarWidth, flexShrink: 0, display: 'flex', flexDirection: 'column',
        transition: transitionStyle, overflow: 'hidden',
        borderRight: sidebarWidth > 0 ? '1px solid #333' : 'none',
      }}>
        <Sidebar
          isVisible={true}
          currentView={activeActivityView}
          refreshTrigger={sidebarRefreshTrigger}
          onListProjects={listSavedProjects}
          onCreateProject={createNewProject}
          onDeleteProject={removeProject}
          onListPipelines={listProjectPipelines}
          onLoadPipeline={openPipelineTab}
          onRequestSave={handleRequestSaveFromSidebar}
          onDeletePipeline={removePipeline}
          onLoadWorkflowObject={openWorkflowObjectTab}
        />
      </div>

      <div className="sidebar-resize-handle" onMouseDown={startResizingSidebar} onDoubleClick={toggleSidebar}>
        <div className="sidebar-resize-line" />
        <button className="resize-toggle-btn"
          onClick={e => { e.stopPropagation(); toggleSidebar(); }}
          onMouseDown={e => e.stopPropagation()}
          title={sidebarWidth > 20 ? 'Collapse Sidebar' : 'Expand Sidebar'}>
          {sidebarWidth > 20 ? '◀' : '▶'}
        </button>
      </div>

      <div className="content-area">
        {/* ── Header (resizable) ─────────────────────────────────────────── */}
        <header className="header-container" style={{ height: headerHeight, transition: transitionStyle }}>

          {/* Row 1: menu bar (File menu + breadcrumb) */}
          <MenuBar
            workflowName={workflow.name || 'Untitled'}
            projectName={projectName || undefined}
            isModified={activeTab?.isModified}
            onNew={handleNewTab}
            onSave={handleSave}
            onSaveAs={handleSaveAs}
            onRename={() => setRenameModalOpen(true)}
          />

          {/* Row 2: file tabs */}
          <div className="tabs-row">
            <WorkflowTabs
              tabs={openTabs}
              onTabClick={handleTabClick}
              onTabClose={handleTabClose}
              onNewTab={handleNewTab}
            />
          </div>

          {/* Row 3: pipeline controls */}
          <div className="workflow-tools-row">
            <div className="workflow-controls-wrapper">
              <GlobalControls
                onRunAll={runPipeline}
                onPauseAll={pausePipeline}
                onStopAll={stopPipeline}
                pipelineStatus={pipelineStatus}
                workflowName={workflow.name}
              />
            </div>
          </div>
        </header>

        <div className="resize-handle" onMouseDown={startResizingHeader} onDoubleClick={toggleHeader}>
          <div className="resize-line" />
          <button className="resize-toggle-btn"
            onClick={e => { e.stopPropagation(); toggleHeader(); }}
            onMouseDown={e => e.stopPropagation()}
            title={headerHeight > 60 ? 'Collapse Header' : 'Expand Header'}>
            {headerHeight > 60 ? '▲' : '▼'}
          </button>
        </div>

        {/* ── Pipeline canvas ────────────────────────────────────────────── */}
        <main className="main-content horizontal-scroll-area">
          <StepWiringProvider>
          <div className="columns-container" data-testid="columns-container">
            {workflow.steps.map((step, index) => {
              const isExpanded = expandedStepIds.has(step.id);
              const isMaximized = maximizedStepId === step.id;
              return (
                <div key={step.id} className={`column-wrapper ${isMaximized ? 'maximized' : (isExpanded ? 'expanded' : 'collapsed')}`}>
                  <OperationColumn
                    step={step}
                    stepIndex={index}
                    color={getStepColor(index)}
                    isActive={isExpanded}
                    isSqueezed={!isExpanded}
                    isMaximized={isMaximized}
                    zIndex={workflow.steps.length - index}
                    availableOperations={availableOperations}
                    onActivate={() => toggleStep(step.id)}
                    onUpdate={(id, updates) => updateStep(id, updates)}
                    onRun={runStep}
                    onPreview={previewStep}
                    onPause={id => console.log('Pause', id)}
                    onDelete={deleteStep}
                    onMinimize={() => collapseStep(step.id)}
                    onMaximize={() => toggleMaximizeStep(step.id)}
                  />
                </div>
              );
            })}
            <div className="add-step-container">
              <button className="rectangular-add-btn" onClick={() => addStepAt(workflow.steps.length)} title="Add New Step">
                + Add Step
              </button>
            </div>
          </div>
          </StepWiringProvider>
        </main>
      </div>

      {/* Right sidebar resize handle */}
      <div className="sidebar-resize-handle" onMouseDown={startResizingRightSidebar} onDoubleClick={toggleChat}>
        <div className="sidebar-resize-line" />
        <button className="resize-toggle-btn"
          onClick={e => { e.stopPropagation(); toggleChat(); }}
          onMouseDown={e => e.stopPropagation()}
          title={rightSidebarWidth > 20 ? 'Close Chat' : 'Open Chat'}>
          {rightSidebarWidth > 20 ? '▶' : '◀'}
        </button>
      </div>

      {/* Right chat sidebar */}
      <div style={{
        width: rightSidebarWidth, flexShrink: 0, display: 'flex', flexDirection: 'column',
        overflow: 'hidden', transition: transitionStyle,
        opacity: rightSidebarWidth > 20 ? 1 : 0,
      }}>
        <ChatSidebar isVisible={true} onClose={toggleChat} />
      </div>

      {/* ── Save modal ──────────────────────────────────────────────────── */}
      <SaveModal
        isOpen={saveModalOpen}
        title={saveAsMode ? 'Save Pipeline As…' : 'Save Pipeline'}
        defaultName={workflow.name || 'my-pipeline'}
        preselectProjectId={preselectProjectId}
        onClose={() => { setSaveModalOpen(false); setPreselectProjectId(undefined); setPreselectProjectName(undefined); }}
        onSave={async (projectId, pipelineName, projectDisplayName) => {
          await handleModalSave(projectId, pipelineName, projectDisplayName ?? preselectProjectName);
          setSaveModalOpen(false);
          setPreselectProjectId(undefined);
          setPreselectProjectName(undefined);
        }}
        onCreateProject={createNewProject}
        onListProjects={listSavedProjects}
      />

      {/* ── Rename modal ─────────────────────────────────────────────────── */}
      <RenameModal
        isOpen={renameModalOpen}
        currentName={workflow.name || 'Untitled'}
        onClose={() => setRenameModalOpen(false)}
        onRename={handleRename}
      />
    </div>
  );
}


import { useState, useCallback, useRef, useEffect } from 'react';
import { Allotment } from 'allotment';
import WorkflowTabs, { type WorkflowTab } from './WorkflowTabs';
import UnifiedToolbar, { type PipelineMeta } from './UnifiedToolbar';
import OperationColumn from './OperationColumn';
import DetachedStepWindow from './DetachedStepWindow';
import useWorkflow from '../hooks/useWorkflow';
import { getStepColor } from '../styles/theme';
import Sidebar from './Sidebar';
import ChatSidebar from './ChatSidebar';
import ActivityBar from './ActivityBar';
import MenuBar from './MenuBar';
import WorkspaceFileEditor from './WorkspaceFileEditor';
import SaveModal from './SaveModal';
import RenameModal from './RenameModal';
import ExecutionLog from './ExecutionLog';
import type { ActivityView } from './ActivityBar';
import type { Workflow } from '../types/models';
import { initialWorkflow } from '../mocks/initialData';
import { StepWiringProvider } from '../context/StepWiringContext';
import './MainLayout.css';

// ── Layout constants ───────────────────────────────────────────────────────
// Sizes the user sees on first launch. Allotment will persist user drags
// in-memory for the session; durable persistence is a follow-up (S4 settings).
const DEFAULT_LEFT_SIDEBAR_WIDTH = 250;
const DEFAULT_RIGHT_SIDEBAR_WIDTH = 300;
const DEFAULT_HEADER_HEIGHT = 110;
const MIN_HEADER_HEIGHT = 44;
const MAX_HEADER_HEIGHT = 600;
const SIDEBAR_SNAP_THRESHOLD = 80; // dragging below this pixel width collapses the pane

// ── Types ──────────────────────────────────────────────────────────────────

interface OpenTab extends WorkflowTab {
  projectId?: string;          // undefined = unsaved / demo
  projectDisplayName?: string; // human-readable project name for breadcrumb
  pipelineId?: string;
  workflow: Workflow;
}

interface DetachedWindow {
  id: string;          // unique window id (not step id — same step can detach multiple times)
  stepId: string;
  position: { x: number; y: number };
}

// ── Component ──────────────────────────────────────────────────────────────

export default function MainLayout() {
  const [activeActivityView, setActiveActivityView] = useState<ActivityView>('explorer');
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [isFileEditorOpen, setIsFileEditorOpen] = useState(false);

  // Pane visibility — Allotment handles the actual width animation via `visible`.
  const [leftPaneVisible, setLeftPaneVisible] = useState(true);
  const [rightPaneVisible, setRightPaneVisible] = useState(true);

  // Live right-pane width so the floating ExecutionLog overlay can offset itself.
  const [rightPaneWidth, setRightPaneWidth] = useState(DEFAULT_RIGHT_SIDEBAR_WIDTH);

  const {
    workflow,
    availableOperations,
    expandedStepIds,
    pipelineStatus,
    maximizedStepId,
    stepProgress,
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
    executionLogs,
    clearLogs,
  } = useWorkflow();

  // ── Tab state ────────────────────────────────────────────────────────────
  // Start with the initial workflow as the first tab
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([
    { id: 'initial', title: initialWorkflow.name, isActive: true, workflow: initialWorkflow },
  ]);

  const activeTab = openTabs.find(t => t.isActive) ?? openTabs[0];
  const projectName = activeTab?.projectDisplayName ?? activeTab?.projectId ?? '';
  const runningStepIndex = workflow.steps.findIndex((s) => s.status === 'running');
  const pipelineCursorIndex = runningStepIndex >= 0
    ? runningStepIndex
    : workflow.steps.findIndex((s) => s.status !== 'completed');

  // ── Pipeline meta stats — computed from live workflow steps ──────────
  const pipelineMeta: PipelineMeta = (() => {
    const steps = workflow.steps;
    // Find last completed step with output for data dimensions
    const lastDone = [...steps].reverse().find(s => s.status === 'completed' && s.outputRefId);
    const rows = lastDone?.outputRows ?? 0;
    const cols = lastDone?.outputColumns?.length ?? 0;
    return {
      rows,
      cols,
      cells: rows * cols,
      counts: {
        staged:  steps.filter(s => s.status === 'completed' && !!s.outputRefId).length,
        queued:  steps.filter(s => s.status === 'pending').length,
        running: steps.filter(s => s.status === 'running').length,
        ran:     steps.filter(s => s.status === 'completed').length,
        errors:  steps.filter(s => s.status === 'error').length,
      },
    };
  })();

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
      // saved.id is the slug derived from pipelineName, matching the filename on disk
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
      setSidebarRefreshTrigger(n => n + 1);
    } finally {
      suppressModified.current = false;
    }
  }, [saveWorkflow]);

  const handleRename = useCallback((newName: string) => {
    setOpenTabs(prev => prev.map(t => {
      if (!t.isActive) return t;
      return { ...t, title: `${newName}.json`, isModified: true };
    }));
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
    let wf: Workflow;
    try {
      wf = await fetchWorkflow(projectId, pipelineId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to open pipeline', { projectId, pipelineId, err });
      window.alert(`Failed to open pipeline "${pipelineId}": ${message}`);
      return;
    }
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

  // NOTE: openWorkflowObjectTab is kept for future use (e.g. opening demo workflows).
  // @ts-expect-error TS6133 — reserved for future use
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _openWorkflowObjectTab = useCallback((wf: Workflow) => {
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

  // ── Activity-bar / sidebar toggles ────────────────────────────────────
  // Clicking the active view collapses; clicking a different view expands+switches.
  const handleViewChange = (view: ActivityView) => {
    if (view === activeActivityView) {
      setLeftPaneVisible(v => !v);
    } else {
      setActiveActivityView(view);
      setLeftPaneVisible(true);
    }
  };

  const handleOpenFileEditor = useCallback(() => {
    setActiveActivityView('explorer');
    setLeftPaneVisible(true);
    setIsFileEditorOpen(true);
  }, []);

  const toggleChat = useCallback(() => setRightPaneVisible(v => !v), []);

  // ── Detached step windows ──────────────────────────────────────────────
  const [detachedWindows, setDetachedWindows] = useState<DetachedWindow[]>([]);

  const handleDetach = useCallback((stepId: string, position: { x: number; y: number }) => {
    setDetachedWindows(prev => [
      ...prev,
      { id: `dw-${Date.now()}-${stepId}`, stepId, position },
    ]);
  }, []);

  const closeDetachedWindow = useCallback((windowId: string) => {
    setDetachedWindows(prev => prev.filter(w => w.id !== windowId));
  }, []);

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

  // ── Allotment pane-size handlers ──────────────────────────────────────
  // Snap to "collapsed" when the user drags the divider very small, so the
  // sidebar can never get stuck in a sliver state.
  const handleOuterSizes = useCallback((sizes: number[]) => {
    // sizes[0] = left pane, sizes[1] = center, sizes[2] = right pane
    const leftSize = sizes[0] ?? 0;
    const rightSize = sizes[2] ?? 0;

    if (leftPaneVisible && leftSize > 0 && leftSize < SIDEBAR_SNAP_THRESHOLD) {
      setLeftPaneVisible(false);
    }
    if (rightPaneVisible && rightSize > 0 && rightSize < SIDEBAR_SNAP_THRESHOLD) {
      setRightPaneVisible(false);
    }
    setRightPaneWidth(rightSize);
  }, [leftPaneVisible, rightPaneVisible]);

  // ── Render ────────────────────────────────────────────────────────────────

  const headerBlock = (
    <header className="header-container">
      {/* Row 1: menu bar (File menu + breadcrumb) */}
      <MenuBar
        workflowName={workflow.name || 'Untitled'}
        projectName={projectName || undefined}
        isModified={activeTab?.isModified}
        onNew={handleNewTab}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onRename={() => setRenameModalOpen(true)}
        onEditFiles={handleOpenFileEditor}
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
      <UnifiedToolbar
        onRunAll={runPipeline}
        onPauseAll={pausePipeline}
        onStopAll={stopPipeline}
        pipelineStatus={pipelineStatus}
        logCount={executionLogs.length}
        logErrorCount={executionLogs.filter(l => l.level === 'error').length}
        isLogOpen={isLogOpen}
        onToggleLogs={() => setIsLogOpen(prev => !prev)}
        onClearOutputs={clearLogs}
        availableOperations={availableOperations}
        pipelineMeta={pipelineMeta}
      />
    </header>
  );

  const canvasBlock = (
    <main className="main-content horizontal-scroll-area">
      <StepWiringProvider>
        <div className="columns-container" data-testid="columns-container">
          {workflow.steps.map((step, index) => {
            const isExpanded = expandedStepIds.has(step.id);
            const isMaximized = maximizedStepId === step.id;
            const previousSteps = workflow.steps.slice(0, index);
            return (
              <div key={step.id} className={`column-wrapper ${isMaximized ? 'maximized' : (isExpanded ? 'expanded' : 'collapsed')}`}>
                <OperationColumn
                  step={step}
                  stepIndex={index}
                  previousSteps={previousSteps}
                  color={getStepColor(index)}
                  isActive={isExpanded}
                  isSqueezed={!isExpanded}
                  isMaximized={isMaximized}
                  zIndex={isExpanded ? 100 : workflow.steps.length - index}
                  availableOperations={availableOperations}
                  progress={stepProgress[step.id]}
                  pipelineStatus={pipelineStatus}
                  pipelineCursorIndex={pipelineCursorIndex}
                  onActivate={() => toggleStep(step.id)}
                  onUpdate={(id, updates) => updateStep(id, updates)}
                  onRun={runStep}
                  onPreview={previewStep}
                  onPause={id => console.log('Pause', id)}
                  onDelete={deleteStep}
                  onMinimize={() => collapseStep(step.id)}
                  onMaximize={() => toggleMaximizeStep(step.id)}
                  onDetach={(pos) => handleDetach(step.id, pos)}
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
  );

  return (
    <div className="main-layout" data-testid="main-layout">
      <ActivityBar activeView={activeActivityView} onViewChange={handleViewChange} />

      {/* ── Three-pane shell: left sidebar | content | right chat ───────── */}
      <div className="main-layout__panes">
        <Allotment onChange={handleOuterSizes} proportionalLayout={false}>
          {/* Left sidebar (Explorer / Packs / Search / History / Settings) */}
          <Allotment.Pane
            preferredSize={DEFAULT_LEFT_SIDEBAR_WIDTH}
            minSize={150}
            maxSize={500}
            snap
            visible={leftPaneVisible}
          >
            <div className="main-layout__sidebar-pane">
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
              />
            </div>
          </Allotment.Pane>

          {/* Center content: header (vertical split) over canvas */}
          <Allotment.Pane minSize={400}>
            <div className="content-area">
              <Allotment vertical proportionalLayout={false}>
                <Allotment.Pane
                  preferredSize={DEFAULT_HEADER_HEIGHT}
                  minSize={MIN_HEADER_HEIGHT}
                  maxSize={MAX_HEADER_HEIGHT}
                >
                  {headerBlock}
                </Allotment.Pane>
                <Allotment.Pane minSize={200}>
                  {canvasBlock}
                </Allotment.Pane>
              </Allotment>

              {/* ExecutionLog is a fixed-position overlay; offset by current right-pane width */}
              <ExecutionLog
                logs={executionLogs}
                onClear={clearLogs}
                isOpen={isLogOpen}
                onClose={() => setIsLogOpen(false)}
                rightOffset={(rightPaneVisible ? rightPaneWidth : 0) + 30}
              />
            </div>
          </Allotment.Pane>

          {/* Right chat / agent sidebar */}
          <Allotment.Pane
            preferredSize={DEFAULT_RIGHT_SIDEBAR_WIDTH}
            minSize={200}
            maxSize={600}
            snap
            visible={rightPaneVisible}
          >
            <div className="main-layout__chat-pane">
              <ChatSidebar
                isVisible={true}
                onClose={toggleChat}
                workflow={workflow}
                availableOperations={availableOperations}
                onApplyFormula={(stepId, formula) => {
                  updateStep(stepId, { formula });
                }}
              />
            </div>
          </Allotment.Pane>
        </Allotment>
      </div>

      {/* ── Detached step windows (floating, fixed-position) ───────────── */}
      <StepWiringProvider>
        {detachedWindows.map(dw => {
          const step = workflow.steps.find(s => s.id === dw.stepId);
          if (!step) return null;
          const stepIndex = workflow.steps.findIndex(s => s.id === dw.stepId);
          const previousSteps = workflow.steps.slice(0, stepIndex);
          return (
            <DetachedStepWindow
              key={dw.id}
              step={step}
              stepIndex={stepIndex}
              previousSteps={previousSteps}
              availableOperations={availableOperations}
              pipelineStatus={pipelineStatus}
              pipelineCursorIndex={pipelineCursorIndex}
              color={getStepColor(stepIndex)}
              initialPosition={dw.position}
              onClose={() => closeDetachedWindow(dw.id)}
              onUpdate={(id, updates) => updateStep(id, updates)}
              onRun={runStep}
              onPreview={previewStep}
              onDelete={deleteStep}
            />
          );
        })}
      </StepWiringProvider>

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

      <WorkspaceFileEditor
        isOpen={isFileEditorOpen}
        onClose={() => setIsFileEditorOpen(false)}
      />
    </div>
  );
}

import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { Allotment, type AllotmentHandle } from 'allotment';
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
import ExecutionLog, { type LogMode } from './ExecutionLog';
import Icon from './Icon';
import type { ActivityView } from './ActivityBar';
import type { Workflow } from '../types/models';
import { initialWorkflow } from '../mocks/initialData';
import { StepWiringProvider } from '../context/StepWiringContext';
import ResourcesMenu from './ResourcesMenu';
import { fetchWorkspaceInfo, openWorkspace, type WorkspaceInfo } from '../services/api';
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
const DEFAULT_LOG_HEIGHT = 220;
// The log's header is 36px; collapsing clamps the pane to exactly that, so the
// expander leaves its title bar docked and nothing else.
const LOG_HEADER_HEIGHT = 36;

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
  // The log is a bottom pane by default and can be popped out into a window.
  const [logMode, setLogMode] = useState<LogMode>('docked');
  const [logCollapsed, setLogCollapsed] = useState(false);
  const [isFileEditorOpen, setIsFileEditorOpen] = useState(false);

  // Pane visibility — Allotment handles the actual width animation via `visible`.
  const [leftPaneVisible, setLeftPaneVisible] = useState(true);
  const [rightPaneVisible, setRightPaneVisible] = useState(true);

  // Live right-pane width so a popped-out ExecutionLog clears the chat pane.
  const [rightPaneWidth, setRightPaneWidth] = useState(DEFAULT_RIGHT_SIDEBAR_WIDTH);

  // The centre column's vertical split (header / canvas / log). Allotment only
  // reads minSize and maxSize when a pane is first created, so collapsing the
  // log has to go through the imperative handle rather than a prop change.
  const centerSplitRef = useRef<AllotmentHandle>(null);
  const centerSizes = useRef<number[]>([]);
  // Height to restore when the log is expanded again.
  const preCollapseLogHeight = useRef<number>(DEFAULT_LOG_HEIGHT);
  // The header's height as the user last left it, captured immediately before
  // a log toggle so the toggle can put it back. See pinHeaderAfterPaneChange.
  const headerHeight = useRef<number>(DEFAULT_HEADER_HEIGHT);

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
    minimizedStepIds,
    minimizeStep,
    insertStep,
    updateStep,
    runStep,
    runPipeline,
    pausePipeline,
    stopPipeline,
    previewStep,
    deleteStep,
    defineResource,
    removeResource,
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
    dispatchCommand,
    consoleStepMap,
  } = useWorkflow();

  // ── Tab state ────────────────────────────────────────────────────────────
  // Start with the initial workflow as the first tab
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([
    { id: 'initial', title: initialWorkflow.name, isActive: true, workflow: initialWorkflow },
  ]);

  // The visible width of the step canvas — what a maximized step fills, so it
  // widens within the main layout instead of under the side panels.
  const canvasRef = useRef<HTMLElement | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(900);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => setCanvasWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const activeTab = openTabs.find(t => t.isActive) ?? openTabs[0];
  const projectName = activeTab?.projectDisplayName ?? activeTab?.projectId ?? '';
  const runningStepIndex = workflow.steps.findIndex((s) => s.status === 'running');
  const pipelineCursorIndex = runningStepIndex >= 0
    ? runningStepIndex
    : workflow.steps.findIndex((s) => s.status !== 'completed');

  // ── Pipeline status counts — computed from live workflow steps ───────
  const pipelineMeta: PipelineMeta = {
    counts: {
      running: workflow.steps.filter(s => s.status === 'running').length,
      errors:  workflow.steps.filter(s => s.status === 'error').length,
    },
  };

  // Suppress isModified when we're switching tabs / loading (not user edits)
  const suppressModified = useRef(false);

  // ── Save / Rename modal state ─────────────────────────────────────────
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveAsMode, setSaveAsMode] = useState(false); // true = always show picker
  const [renameModalOpen, setRenameModalOpen] = useState(false);

  // ── Workspace info (Phase A) ──────────────────────────────────────────
  // Populated once at mount; refreshed after `Open Workspace…` succeeds.
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null);
  useEffect(() => {
    fetchWorkspaceInfo().then(setWorkspaceInfo).catch(() => { /* ignore */ });
  }, []);

  /** Prompt the user for an absolute path, POST it to the backend, and
   *  refresh the workspace info.  If the backend reports
   *  ``requires_restart``, surface that via an alert so the user knows to
   *  re-run ``./start_backend.sh`` in the new directory. */
  const handleOpenWorkspace = useCallback(async () => {
    const target = window.prompt(
      'Open workspace — enter the absolute path of the folder:',
      workspaceInfo?.workspace_root ?? '',
    );
    if (!target) return;
    try {
      const res = await openWorkspace(target);
      const fresh = await fetchWorkspaceInfo();
      setWorkspaceInfo(fresh);
      if (res.requires_restart) {
        window.alert(
          `Workspace recorded: ${res.workspace}\n\n` +
          `A backend restart is required for the switch to take effect.\n` +
          `Stop the backend (Ctrl+C in the terminal) and re-run ` +
          `./start_backend.sh from the new directory.`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      window.alert(`Failed to open workspace: ${message}`);
    }
  }, [workspaceInfo?.workspace_root]);

  const handleOpenRecentWorkspace = useCallback(async (path: string) => {
    try {
      const res = await openWorkspace(path);
      const fresh = await fetchWorkspaceInfo();
      setWorkspaceInfo(fresh);
      if (res.requires_restart) {
        window.alert(
          `Workspace recorded: ${res.workspace}\n\n` +
          `Restart the backend to switch.`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      window.alert(`Failed to open workspace: ${message}`);
    }
  }, []);

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
    const closing = openTabs.find(t => t.id === id);
    // Phase A.6 — prompt before discarding unsaved changes.
    if (closing?.isModified) {
      const proceed = window.confirm(
        `"${closing.title}" has unsaved changes. Close anyway?`,
      );
      if (!proceed) return;
    }
    const closingActive = closing?.isActive;
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

  // ── Execution-log placement ───────────────────────────────────────────
  const handleCenterSizes = useCallback((sizes: number[]) => {
    centerSizes.current = sizes;
  }, []);

  /** Snapshot the header before anything adds or removes the log pane. */
  const rememberHeaderHeight = useCallback(() => {
    const h = centerSizes.current[0];
    if (typeof h === 'number' && h > 0) headerHeight.current = h;
  }, []);

  // Collapsing clamps the log pane to its header and gives the reclaimed
  // height back to the canvas; expanding reverses it. Allotment.resize()
  // takes a size for every pane, so both branches rebuild the whole array.
  const setLogPaneHeight = useCallback((next: number) => {
    const sizes = centerSizes.current;
    if (!centerSplitRef.current || sizes.length < 3) return;
    const [headerH, canvasH, logH] = sizes;
    const delta = logH - next;
    centerSplitRef.current.resize([headerH, canvasH + delta, next]);
  }, []);

  const toggleLogCollapsed = useCallback(() => {
    setLogCollapsed((wasCollapsed) => {
      if (wasCollapsed) {
        setLogPaneHeight(preCollapseLogHeight.current);
      } else {
        // Remember the height we had, but never restore to a sliver.
        const current = centerSizes.current[2] ?? DEFAULT_LOG_HEIGHT;
        preCollapseLogHeight.current = Math.max(current, DEFAULT_LOG_HEIGHT);
        setLogPaneHeight(LOG_HEADER_HEIGHT);
      }
      return !wasCollapsed;
    });
  }, [setLogPaneHeight]);

  // Popping out hands the pane's height back to the canvas; docking restores
  // it, so the canvas doesn't jump a second time when the log returns.
  const popLogOut = useCallback(() => {
    rememberHeaderHeight();
    const current = centerSizes.current[2] ?? DEFAULT_LOG_HEIGHT;
    if (current > LOG_HEADER_HEIGHT) preCollapseLogHeight.current = current;
    setLogMode('floating');
  }, [rememberHeaderHeight]);

  const dockLog = useCallback(() => {
    rememberHeaderHeight();
    setLogMode('docked');
    setLogCollapsed(false);
    // The pane is re-shown this render; size it on the next frame, once
    // Allotment has restored its cached visible size.
    requestAnimationFrame(() => setLogPaneHeight(preCollapseLogHeight.current));
  }, [setLogPaneHeight, rememberHeaderHeight]);

  const toggleLog = useCallback(() => {
    rememberHeaderHeight();
    setIsLogOpen((prev) => !prev);
  }, [rememberHeaderHeight]);

  const closeLog = useCallback(() => {
    rememberHeaderHeight();
    setIsLogOpen(false);
  }, [rememberHeaderHeight]);

  // Adding or removing the log pane makes Allotment redistribute that height
  // across the remaining panes, and the header — which allows up to
  // MAX_HEADER_HEIGHT — absorbs most of it. Measured: opening the log grew the
  // header pane 110px -> 300px, pushing the steps down ~190px and leaving them
  // there after the log was closed again. Allotment offers no "don't touch this
  // pane" option, so pin the header back to the height the user left it at and
  // settle the whole difference against the canvas.
  useLayoutEffect(() => {
    const split = centerSplitRef.current;
    const sizes = centerSizes.current;
    if (!split || sizes.length < 2) return;
    const total = sizes.reduce((a, b) => a + b, 0);
    const header = Math.min(headerHeight.current, MAX_HEADER_HEIGHT);
    const log = sizes.length >= 3 ? sizes[2] : 0;
    const canvas = total - header - log;
    if (canvas <= 0) return;
    split.resize(sizes.length >= 3 ? [header, canvas, log] : [header, canvas]);
  }, [isLogOpen, logMode]);

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
        workspaceName={workspaceInfo?.name}
        recentWorkspaces={workspaceInfo?.recent_workspaces ?? []}
        onOpenWorkspace={handleOpenWorkspace}
        onOpenRecentWorkspace={handleOpenRecentWorkspace}
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
        onToggleLogs={toggleLog}
        onClearOutputs={clearLogs}
        pipelineMeta={pipelineMeta}
        resourcesMenu={
          <ResourcesMenu
            resources={workflow.resources}
            steps={workflow.steps}
            onDefine={defineResource}
            onRemove={removeResource}
          />
        }
      />

      {/* Visible drag-hint at the header's bottom edge — signals that the
          toolbar area itself is resizable via the sash beneath it. */}
      <div className="header-resize-hint" aria-hidden="true">
        <span className="header-resize-hint__grip" />
      </div>
    </header>
  );

  const canvasBlock = (
    <main className="main-content horizontal-scroll-area" ref={canvasRef}>
      <StepWiringProvider>
        <div
          className="columns-container"
          data-testid="columns-container"
          style={{ '--canvas-width': `${canvasWidth}px` } as React.CSSProperties}
        >
          {workflow.steps.map((step, index) => {
            const isExpanded = expandedStepIds.has(step.id);
            const isMaximized = maximizedStepId === step.id;
            const isMinimized = !isExpanded && minimizedStepIds.has(step.id);
            const previousSteps = workflow.steps.slice(0, index);
            const size = isMaximized ? 'maximized' : isExpanded ? 'expanded' : isMinimized ? 'minimized' : 'collapsed';
            return (
              <div key={step.id} className={`column-wrapper ${size}`}>
                <OperationColumn
                  step={step}
                  stepIndex={index}
                  previousSteps={previousSteps}
                  color={getStepColor(index)}
                  isActive={isExpanded}
                  isSqueezed={!isExpanded}
                  isMaximized={isMaximized}
                  isMinimized={isMinimized}
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
                  onMinimizeStep={() => minimizeStep(step.id)}
                  allStepNames={workflow.steps.map((s) => s.label)}
                  onInsertStepBefore={(label, formula) => insertStep(index, label, formula)}
                  onSetStepFormula={(id, formula) => updateStep(id, {
                    formula, operation: formula, process_type: 'identity', configuration: {},
                  })}
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
        {/* Peek tabs — visible only when the matching pane is collapsed.
            Provide a clear, clickable affordance to bring the pane back. */}
        {!leftPaneVisible && (
          <button
            type="button"
            className="pane-peek-tab pane-peek-tab--left"
            onClick={() => setLeftPaneVisible(true)}
            title="Show sidebar"
            aria-label="Show sidebar"
          >
            <Icon name="chevron-right" size={12} />
          </button>
        )}
        {!rightPaneVisible && (
          <button
            type="button"
            className="pane-peek-tab pane-peek-tab--right"
            onClick={() => setRightPaneVisible(true)}
            title="Show chat"
            aria-label="Show chat"
          >
            <Icon name="chevron-left" size={12} />
          </button>
        )}

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
                availableOperations={availableOperations}
                onListProjects={listSavedProjects}
                onCreateProject={createNewProject}
                onDeleteProject={removeProject}
                onListPipelines={listProjectPipelines}
                onLoadPipeline={openPipelineTab}
                onRequestSave={handleRequestSaveFromSidebar}
                onDeletePipeline={removePipeline}
              />
              {/* Collapse toggle pinned to the inner edge — click to hide the
                  sidebar.  A matching peek-tab (rendered below) brings it back. */}
              <button
                type="button"
                className="pane-collapse-toggle pane-collapse-toggle--left"
                onClick={() => setLeftPaneVisible(false)}
                title="Hide sidebar"
                aria-label="Hide sidebar"
              >
                <Icon name="chevron-left" size={12} />
              </button>
            </div>
          </Allotment.Pane>

          {/* Center content: header (vertical split) over canvas */}
          <Allotment.Pane minSize={400}>
            <div className="content-area">
              <Allotment
                vertical
                proportionalLayout={false}
                ref={centerSplitRef}
                onChange={handleCenterSizes}
              >
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

                {/* The execution log docks here, below the canvas and between
                    the two sidebars.

                    The pane exists only while the log is OPEN. A permanently
                    mounted pane that is merely `visible={false}` makes
                    Allotment reserve its preferredSize in the first layout
                    pass, which pushed the canvas down and left a gap under the
                    workflow tabs until the first log toggle forced a
                    redistribute. With the log closed the centre column is the
                    same two-pane split it has always been.

                    While the log is open, `visible` (not unmounting) is what
                    hides the pane for the floating case: Allotment sizes a
                    hidden pane to 0 rather than unmounting it, so ExecutionLog
                    keeps its place in the React tree and can portal itself out
                    without losing its filter and scroll state. */}
                {isLogOpen && (
                <Allotment.Pane
                  preferredSize={DEFAULT_LOG_HEIGHT}
                  minSize={LOG_HEADER_HEIGHT}
                  visible={logMode === 'docked'}
                >
                  <ExecutionLog
                    logs={executionLogs}
                    onClear={clearLogs}
                    isOpen={isLogOpen}
                    onClose={closeLog}
                    mode={logMode}
                    collapsed={logCollapsed}
                    onToggleCollapse={toggleLogCollapsed}
                    onPopOut={popLogOut}
                    onDock={dockLog}
                    rightOffset={(rightPaneVisible ? rightPaneWidth : 0) + 30}
                    dispatchCommand={dispatchCommand}
                    consoleStepMap={consoleStepMap}
                  />
                </Allotment.Pane>
                )}
              </Allotment>
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
                onApplyCommands={async (commands) => {
                  // One at a time, in order: an `add` must exist before the
                  // `set` that names it. The console shows them as from the agent.
                  for (const command of commands) {
                    await dispatchCommand(command, 'agent');
                  }
                }}
              />
              <button
                type="button"
                className="pane-collapse-toggle pane-collapse-toggle--right"
                onClick={() => setRightPaneVisible(false)}
                title="Hide chat"
                aria-label="Hide chat"
              >
                <Icon name="chevron-right" size={12} />
              </button>
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

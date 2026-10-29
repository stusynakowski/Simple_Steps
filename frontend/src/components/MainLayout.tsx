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
import { nextUntitledName } from '../utils/workflowNames';
import { StepWiringProvider } from '../context/StepWiringContext';
import { StepsStatusProvider } from '../context/StepsStatusContext';
import StepsStatusText from './StepsStatusText';
import InspectorChips from './InspectorChips';
import ResourcesMenu from './ResourcesMenu';
import BarChevrons from './BarChevrons';
import WorkflowOverview from './WorkflowOverview';
import { useConnection } from '../hooks/useConnection';
import { fetchWorkspaceInfo, openWorkspace, WorkflowExistsError, type ResourceDeclaration, type WorkspaceInfo } from '../services/api';
import './MainLayout.css';

// ── Layout constants ───────────────────────────────────────────────────────
// Sizes the user sees on first launch. Allotment will persist user drags
// in-memory for the session; durable persistence is a follow-up (S4 settings).
const DEFAULT_LEFT_SIDEBAR_WIDTH = 250;
const DEFAULT_RIGHT_SIDEBAR_WIDTH = 300;
// The header pane has two heights. Dragging its sash up hides the toolbar so
// the steps reach the file tabs; dragging down shows it again, and no further —
// there is nothing below the toolbar to reveal. Allotment reads min/max only
// when the pane is created, so these are summed from the CSS rather than
// measured: menubar 30 (MenuBar.css) + tabs 35 (WorkflowTabs.css) + the
// header's 1px border, then the two-row toolbar 72 (UnifiedToolbar.css) + grip 4.
const HEADER_COLLAPSED_HEIGHT = 66;
const HEADER_EXPANDED_HEIGHT = 142;
const SIDEBAR_SNAP_THRESHOLD = 80; // dragging below this pixel width collapses the pane
// The console's floor while the steps auto-fit: tall steps stop here rather
// than squeezing the console to a sliver.
const DEFAULT_LOG_HEIGHT = 220;
// The log's header (title bar) — all a collapsed console shows: 36px plus its
// 1px bottom border (.execution-log-header). Measured 37 in the browser; at 36
// a maximized step viewer pushed the title bar 1px past the bottom.
const LOG_HEADER_HEIGHT = 37;
// The step viewer's footer (.steps-footer): the bottom bar of the steps, and
// the handle between them and the console. VS Code style: it sits under the
// tallest step (auto-fit) until dragged, then stays where it was put;
// double-click returns it to auto-fit. On release either side snaps shut below
// its threshold, like the sidebars. The steps and the console collapse
// independently — space neither fills shows the canvas background.
const STEPS_FOOTER_HEIGHT = 20;
const STEPS_SNAP_THRESHOLD = 80;
const LOG_SNAP_THRESHOLD = 80; // of console body, below its title bar
// Room under the tallest step, so its border doesn't touch the footer.
const STEPS_FIT_PADDING = 4;

// ── Types ──────────────────────────────────────────────────────────────────

interface OpenTab extends WorkflowTab {
  projectId?: string;          // undefined = unsaved / demo
  projectDisplayName?: string; // human-readable project name for breadcrumb
  pipelineId?: string;
  workflow: Workflow;
}

/** One tab per workflow file: the key every open/save path agrees on. */
const pipelineTabKey = (projectId: string, pipelineId: string) => `${projectId}::${pipelineId}`;

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
  // Steps maximized: their footer as low as it goes — on the console's title
  // bar, or at the bottom of the page with the console closed. Anything that
  // expands the console ends it, so the console has room.
  const [stepsMaximized, setStepsMaximized] = useState(false);
  const [isFileEditorOpen, setIsFileEditorOpen] = useState(false);

  // Pane visibility — Allotment handles the actual width animation via `visible`.
  const [leftPaneVisible, setLeftPaneVisible] = useState(true);
  const [rightPaneVisible, setRightPaneVisible] = useState(true);

  // Live right-pane width so a popped-out ExecutionLog clears the chat pane.
  const [rightPaneWidth, setRightPaneWidth] = useState(DEFAULT_RIGHT_SIDEBAR_WIDTH);

  // The centre column's vertical split: header over body. The body (steps,
  // bar, console) is laid out by hand below — Allotment needs its panes to sum
  // to the full height, which would rule out showing background between them.
  const centerSplitRef = useRef<AllotmentHandle>(null);

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
    updateStep,
    runStep,
    declareWorkflow,
    runPipeline,
    pausePipeline,
    stopPipeline,
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

  const connection = useConnection();
  // The activity pill shows what the run is doing, not the debug chatter.
  const latestLog = [...executionLogs].reverse().find(l => l.level !== 'debug');

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
        // Write back to the file this tab came from, even after a rename —
        // deriving the file from the (new) name would fork it into a second file.
        await saveWorkflow(activeTab.projectId, activeTab.workflow.name || activeTab.pipelineId, {
          pipelineId: activeTab.pipelineId,
        });
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
      // Create-only first, so an existing workflow of the same name is never
      // replaced silently. Re-saving the tab's own file is not a conflict.
      let saved;
      try {
        saved = await saveWorkflow(projectId, pipelineName, { overwrite: false });
      } catch (err) {
        if (!(err instanceof WorkflowExistsError)) throw err;
        const ownFile = activeTab?.projectId === err.projectId && activeTab?.pipelineId === err.pipelineId;
        if (!ownFile && !window.confirm(`${err.message}\n\nReplace it?`)) {
          throw new Error(`"${pipelineName}" already exists in this project — choose a different name.`);
        }
        saved = await saveWorkflow(projectId, pipelineName, { pipelineId: err.pipelineId });
      }
      // saved.id is the file stem the backend wrote to — the same id the
      // sidebar and file tree open it by. Any other tab on that file now shows
      // replaced content, so it is dropped: one file never has two tabs.
      const key = pipelineTabKey(projectId, saved.id);
      setOpenTabs(prev => prev.filter(t => t.isActive || t.id !== key).map(t => {
        if (!t.isActive) return t;
        return {
          ...t,
          id: key,
          title: pipelineName,
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
  }, [activeTab, saveWorkflow]);

  const handleRename = useCallback((newName: string) => {
    setOpenTabs(prev => prev.map(t => {
      if (!t.isActive) return t;
      return { ...t, title: newName, isModified: true };
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
  // Keys of workflows still being fetched: a second click while the first is
  // loading must not open a second tab on the same file.
  const openingTabs = useRef(new Set<string>());
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;

  const openPipelineTab = useCallback(async (projectId: string, pipelineId: string) => {
    const focusTab = (key: string): boolean => {
      const existing = openTabsRef.current.find(t => t.id === key);
      if (!existing) return false;
      setOpenTabs(prev => prev.map(t => ({ ...t, isActive: t.id === key })));
      suppressModified.current = true;
      loadWorkflowObject(existing.workflow);
      setTimeout(() => { suppressModified.current = false; }, 0);
      return true;
    };

    const requestedKey = pipelineTabKey(projectId, pipelineId);
    if (focusTab(requestedKey) || openingTabs.current.has(requestedKey)) return;
    openingTabs.current.add(requestedKey);
    let wf: Workflow;
    try {
      wf = await fetchWorkflow(projectId, pipelineId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to open pipeline', { projectId, pipelineId, err });
      window.alert(`Failed to open pipeline "${pipelineId}": ${message}`);
      return;
    } finally {
      openingTabs.current.delete(requestedKey);
    }
    // The backend reports the file stem as the id, so the same file reached by
    // another spelling (file tree vs. sidebar) still lands on one tab.
    pipelineId = wf.id || pipelineId;
    const tabKey = pipelineTabKey(projectId, pipelineId);
    if (focusTab(tabKey)) return;
    const newTab: OpenTab = {
      id: tabKey,
      title: wf.name,
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
  }, [fetchWorkflow, loadWorkflowObject]);

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
      title: wf.name,
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
    // VS Code style: each new workflow gets the lowest free Untitled-N, so two
    // new tabs never share a name (and so never default to the same file).
    const name = nextUntitledName(openTabsRef.current.map(t => t.title));
    const blank: Workflow = {
      id: `new-${Date.now()}`,
      name,
      created_at: new Date().toISOString(),
      steps: [],
    };
    const newTab: OpenTab = {
      id: blank.id,
      title: name,
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
  // The console sits in the hand-laid body under the steps, so opening,
  // closing, collapsing or popping it out changes no Allotment pane — the
  // header can't be pushed around by it.
  const toggleLogCollapsed = useCallback(() => {
    if (logCollapsed) setStepsMaximized(false);
    setLogCollapsed(!logCollapsed);
  }, [logCollapsed]);
  const popLogOut = useCallback(() => setLogMode('floating'), []);
  const dockLog = useCallback(() => {
    setLogMode('docked');
    setLogCollapsed(false);
    setStepsMaximized(false);
  }, []);
  const toggleLog = useCallback(() => {
    if (!isLogOpen) setStepsMaximized(false);
    setIsLogOpen(!isLogOpen);
  }, [isLogOpen]);
  const closeLog = useCallback(() => setIsLogOpen(false), []);

  // Between its two heights the header would show the toolbar half-cut, so on
  // release snap to whichever is nearer and give the difference to the body.
  const snapHeader = useCallback((sizes: number[]) => {
    const split = centerSplitRef.current;
    const [h, body] = sizes;
    if (!split || h === undefined || body === undefined) return;
    const mid = (HEADER_COLLAPSED_HEIGHT + HEADER_EXPANDED_HEIGHT) / 2;
    const next = h < mid ? HEADER_COLLAPSED_HEIGHT : HEADER_EXPANDED_HEIGHT;
    if (next !== h) split.resize([next, body + h - next]);
  }, []);

  // ── Steps / console split ──────────────────────────────────────────────
  // The body below the header is: steps region, bar, console, background.
  // The steps region auto-fits the tallest step until the bar is dragged
  // (`manualStepsHeight` set), VS Code style; double-click goes back to
  // auto-fit. Steps and console collapse independently.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [bodyHeight, setBodyHeight] = useState(0);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setBodyHeight(el.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [stepsCollapsed, setStepsCollapsed] = useState(false);
  const [manualStepsHeight, setManualStepsHeight] = useState<number | null>(null);
  const [fitStepsHeight, setFitStepsHeight] = useState(0);
  const autoFit = manualStepsHeight === null;

  const consoleDocked = isLogOpen && logMode === 'docked';
  // The most the steps may take: auto-fit leaves the console its default
  // height; a drag may squeeze it to its title bar.
  const maxAutoSteps = Math.max(0, bodyHeight - STEPS_FOOTER_HEIGHT
    - (consoleDocked ? (logCollapsed ? LOG_HEADER_HEIGHT : DEFAULT_LOG_HEIGHT) : 0));
  const maxManualSteps = Math.max(0, bodyHeight - STEPS_FOOTER_HEIGHT - (consoleDocked ? LOG_HEADER_HEIGHT : 0));
  const stepsHeight = stepsCollapsed ? 0
    : stepsMaximized ? maxManualSteps
    : autoFit ? Math.min(fitStepsHeight, maxAutoSteps)
    : Math.min(manualStepsHeight, maxManualSteps);

  // Auto-fit measures the steps as they lay out against the full available
  // height (the columns are given maxAutoSteps, not the region's height — a
  // column is capped at its container, so measuring inside a fitted region
  // would only ever read back the region). Re-measured whenever a column
  // changes size: expanding, running, a grid loading.
  const { steps: workflowSteps } = workflow;
  useLayoutEffect(() => {
    const main = canvasRef.current;
    if (!autoFit || !main) return;
    const measure = () => {
      const top = main.getBoundingClientRect().top;
      let bottom = 0;
      main.querySelectorAll('.column-wrapper > *, .add-step-container > *').forEach((el) => {
        bottom = Math.max(bottom, el.getBoundingClientRect().bottom - top);
      });
      const scrollbar = main.offsetHeight - main.clientHeight;
      setFitStepsHeight(Math.ceil(bottom + scrollbar + STEPS_FIT_PADDING));
    };
    measure();
    const observer = new ResizeObserver(measure);
    main.querySelectorAll('.column-wrapper > *, .add-step-container > *').forEach(el => observer.observe(el));
    observer.observe(main);
    return () => observer.disconnect();
  }, [autoFit, workflowSteps, expandedStepIds, maximizedStepId, minimizedStepIds]);

  const openDockedLog = useCallback(() => {
    setLogMode('docked');
    setLogCollapsed(false);
    setStepsMaximized(false);
    setIsLogOpen(true);
  }, []);

  // The footer's ⌃/⌄ move it one stop at a time:
  //   collapsed  ⇄  normal (fit or dragged)  ⇄  maximized
  // Maximizing minimizes a docked console to its title bar, so the footer
  // lands right on it; with the console closed it lands at the page bottom.
  const stepsUp = useCallback(() => {
    if (stepsMaximized) setStepsMaximized(false);
    else setStepsCollapsed(true);
  }, [stepsMaximized]);
  const stepsDown = useCallback(() => {
    if (stepsCollapsed) {
      setStepsCollapsed(false);
      return;
    }
    setStepsMaximized(true);
    if (consoleDocked) setLogCollapsed(true);
  }, [stepsCollapsed, consoleDocked]);

  // The footer is the drag handle — everywhere but its buttons. Dragging it up
  // while the console is closed opens the console.
  const splitDrag = useRef<{ startY: number; startSteps: number; moved: boolean } | null>(null);
  const [splitDragging, setSplitDragging] = useState(false);

  const onSplitPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    splitDrag.current = { startY: e.clientY, startSteps: stepsHeight, moved: false };
    setSplitDragging(true);
  }, [stepsHeight]);

  const onSplitPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = splitDrag.current;
    if (!drag) return;
    const dy = e.clientY - drag.startY; // downward = the steps grow
    if (!drag.moved && Math.abs(dy) < 3) return;
    drag.moved = true;
    // Dragging up from under the steps opens a closed console.
    if (!isLogOpen && dy < 0) openDockedLog();
    setStepsCollapsed(false);
    setStepsMaximized(false);
    setManualStepsHeight(Math.min(Math.max(drag.startSteps + dy, 0), maxManualSteps));
  }, [isLogOpen, openDockedLog, maxManualSteps]);

  const onSplitPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = splitDrag.current;
    splitDrag.current = null;
    setSplitDragging(false);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!drag || !drag.moved) return;
    // Snap shut below the thresholds, like the sidebars. A collapsed side
    // re-expands to where it was before this drag.
    const steps = Math.min(Math.max(drag.startSteps + (e.clientY - drag.startY), 0), maxManualSteps);
    if (steps < STEPS_SNAP_THRESHOLD) {
      setStepsCollapsed(true);
      setManualStepsHeight(drag.startSteps >= STEPS_SNAP_THRESHOLD ? drag.startSteps : null);
    }
    if (consoleDocked) {
      const consoleBody = bodyHeight - STEPS_FOOTER_HEIGHT - steps - LOG_HEADER_HEIGHT;
      if (consoleBody < LOG_SNAP_THRESHOLD) setLogCollapsed(true);
    }
  }, [maxManualSteps, consoleDocked, bodyHeight]);

  /** Double-click: back to auto-fit, steps shown. */
  const onSplitDoubleClick = useCallback(() => {
    setManualStepsHeight(null);
    setStepsCollapsed(false);
    setStepsMaximized(false);
  }, []);

  // The ⌃/⌄ pair is the same BarChevrons the console's title bar uses, with the
  // same 12px padding, so the two pairs sit in one column and look alike.
  const stepsFooter = (
    <div
      className={`steps-footer${splitDragging ? ' is-dragging' : ''}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize steps and console"
      title="Drag to resize · double-click to fit the steps"
      onPointerDown={onSplitPointerDown}
      onPointerMove={onSplitPointerMove}
      onPointerUp={onSplitPointerUp}
      onPointerCancel={onSplitPointerUp}
      onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button')) onSplitDoubleClick(); }}
    >
      <div className="steps-footer__left">
        <BarChevrons
          upLabel={stepsMaximized ? 'Restore steps' : 'Collapse steps'}
          downLabel={stepsCollapsed ? 'Expand steps' : 'Maximize steps'}
          onUp={stepsUp}
          onDown={stepsDown}
          upDisabled={stepsCollapsed}
          downDisabled={stepsMaximized}
        />
        <span className="steps-footer__title">Steps</span>
      </div>
      {/* Minimized selection inspectors: click one to put it back. */}
      <InspectorChips />
      {/* Bottom right: what the pointer is over, or what's being selected. */}
      <StepsStatusText />
    </div>
  );

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

      {/* Rows 3–4: the two-row workflow toolbar */}
      <UnifiedToolbar
        onRunAll={runPipeline}
        onPauseAll={pausePipeline}
        onStopAll={stopPipeline}
        pipelineStatus={pipelineStatus}
        logCount={executionLogs.length}
        logErrorCount={executionLogs.filter(l => l.level === 'error').length}
        isLogOpen={isLogOpen}
        onToggleLogs={toggleLog}
        pipelineMeta={pipelineMeta}
        connection={connection}
        latestLog={latestLog}
        overviewMenu={
          <WorkflowOverview
            name={workflow.name || 'Untitled'}
            steps={workflow.steps}
            resourceCount={Object.keys(workflow.resources ?? {}).length}
          />
        }
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
        <div
          className="columns-container"
          data-testid="columns-container"
          style={{
            '--canvas-width': `${canvasWidth}px`,
            // Auto-fit: lay the columns out against the full available height
            // so they can be measured (see the steps/console split).
            ...(autoFit && bodyHeight > 0 ? { height: `${maxAutoSteps}px` } : {}),
          } as React.CSSProperties}
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
                  color={step.step_color ?? getStepColor(index)}
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
                  onDeclare={declareWorkflow}
                  onPause={id => console.log('Pause', id)}
                  onDelete={deleteStep}
                  onMinimize={() => collapseStep(step.id)}
                  onMaximize={() => toggleMaximizeStep(step.id)}
                  onMinimizeStep={() => minimizeStep(step.id)}
                  resources={workflow.resources}
                  onDefineResource={defineResource}
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
    </main>
  );

  return (
    // Spans everything, detached step windows included, so any step's grid
    // can report what the pointer is over to the steps bar.
    <StepsStatusProvider>
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
                workflowResources={workflow.resources as Record<string, ResourceDeclaration> | undefined}
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
                onDragEnd={snapHeader}
              >
                <Allotment.Pane
                  preferredSize={HEADER_EXPANDED_HEIGHT}
                  minSize={HEADER_COLLAPSED_HEIGHT}
                  maxSize={HEADER_EXPANDED_HEIGHT}
                >
                  {headerBlock}
                </Allotment.Pane>
                <Allotment.Pane minSize={0}>
                  {/* Steps, bar, console, then the canvas background for any
                      height neither fills. The wiring provider spans the
                      body so the steps bar can show a selection being made. */}
                  <StepWiringProvider>
                  <div className="center-body" ref={bodyRef}>
                    <div
                      className="steps-region"
                      style={bodyHeight > 0 ? { height: stepsHeight } : { flex: '1 1 0' }}
                    >
                      {canvasBlock}
                    </div>

                    {/* The steps' bottom bar; the console's title bar sits
                        flush beneath it. */}
                    {stepsFooter}

                    {/* The console stays mounted while open — floating, it
                        portals itself out from here, keeping its filter and
                        scroll state across pop-out and dock. */}
                    {isLogOpen && (
                  <div
                    className={`console-region${logCollapsed ? ' is-collapsed' : ''}`}
                    style={consoleDocked ? undefined : { display: 'none' }}
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
                  </div>
                    )}

                    {/* Whatever the steps and an expanded console don't fill. */}
                    {!(consoleDocked && !logCollapsed) && <div className="center-filler" />}
                  </div>
                  </StepWiringProvider>
                </Allotment.Pane>
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
              color={step.step_color ?? getStepColor(stepIndex)}
              initialPosition={dw.position}
              onClose={() => closeDetachedWindow(dw.id)}
              onUpdate={(id, updates) => updateStep(id, updates)}
              onRun={runStep}
                  onDeclare={declareWorkflow}
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
    </StepsStatusProvider>
  );
}

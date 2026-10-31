import { useState, useRef, useEffect, useCallback } from 'react';
import type { Workflow, Step, StepStatus, Cell } from '../types/models';
import { initialWorkflow } from '../mocks/initialData';
import { declareResource } from '../services/api';
import { runStep as runStepApi, fetchDataView, fetchStepView, getOperations,
  listProjects, createProject, deleteProject,
  listPipelines, loadPipeline, savePipeline, deletePipeline,
  listenProgress,
  fetchDataMeta,
  syncWorkflow,
} from '../services/api';
import type {
  OperationDefinition, PipelineFile, BackendError, ProgressEvent, WorkflowStepDecl, WorkflowStepState,
} from '../services/api';
import { parseFormula } from '../utils/formulaParser';
import { errorCell } from '../utils/errorCells';
import { stepsUsingResource } from '../utils/resources';
import type { LogEntry, LogLevel } from '../components/ExecutionLog';
import type { WorkflowCommand } from '../types/commands';
import { formatCommand } from '../types/commands';
import { emitConsoleRecord } from '../context/ConsoleContext';

/**
 * A saved file's workflow-level parts: identity, `meta`, `resources`, and every
 * other top-level section verbatim (`sections`), so saving it again never drops
 * one this app doesn't edit yet (stages, ui, extensions, …).
 */
function fileSections(pipeline: PipelineFile): Omit<Workflow, 'steps'> {
  const {
    id, name, created_at, meta, resources,
    steps: _steps, updated_at: _updated, ...sections
  } = pipeline;
  void _steps; void _updated;
  return {
    id, name, created_at,
    ...(meta ? { meta } : {}),
    ...(resources ? { resources } : {}),
    ...(Object.keys(sections).length ? { sections } : {}),
  };
}

/**
 * Hydrate a saved StepConfig into a runtime Step. The formula is the step,
 * shown exactly as saved; process_type and configuration are derived from it.
 * A formula that doesn't parse (the removed older syntax, say) is kept as
 * written and says why when it runs.
 */
async function hydrateStep(s: PipelineFile['steps'][number], i: number): Promise<Step> {
  const formula = s.formula ?? '';
  const parsed = formula ? await parseFormula(formula) : null;
  const usable = !!(parsed?.isValid && parsed.operationId);
  const processType = usable && parsed?.operationId ? parsed.operationId : 'noop';
  // Settings the expression cannot carry (`_orchestrator`, …) ride in config.
  const internalKeys = Object.fromEntries(
    Object.entries(s.config ?? {}).filter(([k]) => k.startsWith('_'))
  );
  const configuration = { ...internalKeys, ...(usable ? (parsed?.args ?? {}) : {}) };

  return {
    id: s.step_id,
    sequence_index: i,
    label: s.label || `Step ${i + 1}`,
    formula,
    process_type: processType,
    configuration: configuration as Record<string, unknown>,
    status: 'pending' as StepStatus,
    // Keep legacy 'operation' field in sync so the formula bar picks it up
    operation: formula,
    ...(typeof s.meta?.step_color === 'string' ? { step_color: s.meta.step_color } : {}),
    ...(typeof s.meta?.notes === 'string' ? { notes: s.meta.notes } : {}),
  };
}

/** Throw the parser's reason when a non-empty formula doesn't parse. */
function assertFormulaParses(formula: string | undefined, parsed: { isValid: boolean; error?: string } | null) {
  const body = (formula ?? '').trim().replace(/^=/, '').trim();
  if (body && parsed && !parsed.isValid) {
    throw new Error(parsed.error ?? `Invalid expression: ${formula}`);
  }
}

function genId(prefix = 'step') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}
export default function useWorkflow() {
  const [workflow, setWorkflow] = useState<Workflow>(initialWorkflow);
  const [availableOperations, setAvailableOperations] = useState<OperationDefinition[]>([]);

  useEffect(() => {
    getOperations().then(setAvailableOperations).catch(console.error);
  }, []);

  // ── Command bus ──────────────────────────────────────────────────────────
  // Every *user-intent* mutation is announced here in its canonical form, so
  // the console transcript is a replayable record of the session. Consequences
  // of a run (status, outputRefId, output_preview) deliberately do NOT pass
  // through: a transcript of consequences cannot be replayed.
  // See docs/dev_plan/118-console-and-gui-parity.md.

  // Whether the command currently being applied came from the console or a
  // click. Set for the duration of dispatchCommand so the emitted record is
  // attributed correctly without threading an argument through every mutator.
  const commandOrigin = useRef<'gui' | 'console' | 'agent'>('gui');

  const announce = useCallback((cmd: WorkflowCommand) => {
    emitConsoleRecord({
      stream: 'command',
      origin: commandOrigin.current,
      text: formatCommand(cmd),
    });
  }, []);

  // Steps are addressed positionally (step1, step2, …) to match the formula
  // bar and step_map, with the label accepted as an alias. Resolution happens
  // now and the id is what gets used — a stored position would silently
  // rewire the graph the moment a step is inserted.
  // Ref to always access the latest workflow state (avoids stale closures in
  // pipeline runs, and lets the command bus resolve step aliases synchronously).
  const workflowRef = useRef(workflow);
  useEffect(() => {
    workflowRef.current = workflow;
  }, [workflow]);

  // ── The session's core workflow (dev_plan/124 phase 2) ─────────────────
  // Every run carries the whole workflow, so its core-syntax steps run in one
  // core workflow on the server: row links carry from step to step, and core
  // says which steps an edit has made out of date. After an edit the steps
  // are synced (declared, nothing run) to learn that straight away.
  const workflowKey = () => workflowRef.current.id || 'untitled';
  const workflowDecl = (): WorkflowStepDecl[] => workflowRef.current.steps.map((s) => ({
    id: s.id, name: s.label, formula: s.formula ?? '', ...(s.outputRefId ? { ref: s.outputRefId } : {}),
  }));
  /**
   * Fetch the view of each step whose view key changed (dev_plan/126 R5, R6):
   * its cells with core's states, types and row ids, and its plan, run or not.
   * Like a sync, a courtesy: a view that can't be fetched leaves the step as it is.
   */
  const refreshViews = useCallback(async (states: Record<string, WorkflowStepState>) => {
    const key = workflowKey();
    for (const [name, state] of Object.entries(states)) {
      const before = workflowRef.current.steps.find((s) => s.label === name);
      if (!before || !state.view_key || before.viewKey === state.view_key) continue;
      try {
        const view = await fetchStepView(key, name);
        const latest = workflowRef.current;
        workflowRef.current = {
          ...latest,
          steps: latest.steps.map((s) => (s.label !== name ? s : {
            ...s,
            viewKey: state.view_key,
            coreState: view.state,
            problems: view.problems,
            plan: view.plan ?? undefined,
            viewColumns: view.columns,
            output_preview: view.cells,
          })),
        };
        setWorkflow(workflowRef.current);
      } catch { /* the step keeps what it shows */ }
    }
  }, []);
  /** Each step as core says: its state, its problems, out of date or not; then its view. */
  const applyStepStates = useCallback((states?: Record<string, WorkflowStepState>) => {
    if (!states) return;
    const patch = (wf: Workflow): Workflow => ({
      ...wf,
      steps: wf.steps.map((s) => {
        const state = states[s.label];
        const staleReason = state?.status === 'stale' && s.outputRefId
          ? (state.stale_reason || 'an earlier step changed') : undefined;
        const coreState = state?.status ?? s.coreState;
        const problems = state?.problems ?? s.problems;
        return staleReason === s.staleReason && coreState === s.coreState && problems === s.problems
          ? s : { ...s, staleReason, coreState, problems };
      }),
    });
    workflowRef.current = patch(workflowRef.current);
    setWorkflow(patch);
    void refreshViews(states);
  }, [refreshViews]);
  /**
   * Show outputs the server produced or kept that the UI doesn't have yet —
   * steps run first because a later one read them, or a reopened workflow's
   * saved outputs — by step name.
   */
  const showOutputs = useCallback(async (outputs?: Record<string, string>) => {
    for (const [name, ref] of Object.entries(outputs ?? {})) {
      const meta = await fetchDataMeta(ref);
      const cells = await fetchDataView(ref) as Cell[];
      const latest = workflowRef.current;
      const next = latest.steps.map((s) => (s.label !== name ? s : {
        ...s,
        status: 'completed' as StepStatus,
        outputRefId: ref,
        outputRows: meta.rows,
        outputColumns: meta.columns,
        output_preview: cells,
      }));
      workflowRef.current = { ...latest, steps: next };
      setWorkflow(workflowRef.current);
    }
  }, []);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Sync the steps with the server, soon (edits come in bursts): after an
   * edit, to learn which later steps are out of date; when a workflow becomes
   * active, so its kernel comes back from disk with its outputs.
   */
  const scheduleSync = useCallback((delay = 300) => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      syncTimer.current = null;
      // A sync is a courtesy: if it fails, the next run reports any problem.
      Promise.resolve()
        .then(() => syncWorkflow(workflowKey(), workflowDecl(), workflowRef.current.resources))
        .then(async ({ steps, outputs }) => {
          await showOutputs(outputs);
          applyStepStates(steps);
        })
        .catch(() => {});
    }, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyStepStates, showOutputs]);
  /** Enter in a formula bar: declare the workflow now (core checks and plans
   *  every step), running nothing (dev_plan/126 D3). */
  const declareWorkflow = useCallback(() => scheduleSync(0), [scheduleSync]);
  // A workflow becoming active (a tab switch, one opened): bring its kernel back.
  const activeWorkflowId = workflow.id;
  useEffect(() => {
    if (workflowRef.current.steps.some((s) => (s.formula ?? '').trim())) scheduleSync();
  }, [activeWorkflowId, scheduleSync]);

  const resolveStepId = useCallback((name: string): string | null => {
    const steps = workflowRef.current.steps;
    const positional = name.match(/^step(\d+)$/i);
    if (positional) {
      const idx = Number(positional[1]) - 1;
      return steps[idx]?.id ?? null;
    }
    const byLabel = steps.find((st) => st.label === name);
    if (byLabel) return byLabel.id;
    return steps.find((st) => st.id === name)?.id ?? null;
  }, []);

  /** The positional alias a step is addressed by, for emitted commands. */
  const stepAlias = useCallback((id: string): string => {
    const idx = workflowRef.current.steps.findIndex((st) => st.id === id);
    return idx >= 0 ? `step${idx + 1}` : id;
  }, []);

  // ── Execution log state ──────────────────────────────────────────────────
  const [executionLogs, setExecutionLogs] = useState<LogEntry[]>([]);
  const logIdCounter = useRef(0);

  const addLog = useCallback((
    level: LogLevel,
    message: string,
    opts?: { stepId?: string; stepLabel?: string; operationId?: string; detail?: string; durationMs?: number }
  ) => {
    const entry: LogEntry = {
      id: `log-${++logIdCounter.current}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      ...opts,
    };
    setExecutionLogs(prev => [...prev, entry]);
  }, []);

  const clearLogs = useCallback(() => setExecutionLogs([]), []);

  const [expandedStepIds, setExpandedStepIds] = useState<Set<string>>(
    new Set(initialWorkflow.steps.length > 0 ? [initialWorkflow.steps[0].id] : [])
  );
  
  const [maximizedStepId, setMaximizedStepId] = useState<string | null>(null);
  // Steps shrunk to a tight header (the header's minimize button). Opening or
  // maximizing a step clears it.
  const [minimizedStepIds, setMinimizedStepIds] = useState<Set<string>>(new Set());
  const unminimize = (id: string) =>
    setMinimizedStepIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  
  // Progress tracking — keyed by step ID
  const [stepProgress, setStepProgress] = useState<Record<string, ProgressEvent>>({});

  const [pipelineStatus, _setPipelineStatus] = useState<'idle' | 'running' | 'paused'>('idle');
  const pipelineStatusRef = useRef<'idle' | 'running' | 'paused'>('idle');

  const STABLE_CHECKS = 2;
  const STABLE_POLL_MS = 250;
  const STABLE_TIMEOUT_MS = 20000;

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const waitForStableOutput = useCallback(async (
    refId: string,
    stepId: string,
    stepLabel: string,
    operationId: string,
  ): Promise<{ rows: number; columns: string[] }> => {
    let lastRows: number | null = null;
    let stableHits = 0;
    const startedAt = performance.now();

    addLog('debug', `Waiting for output stability for "${stepLabel}"`, {
      stepId,
      stepLabel,
      operationId,
      detail: `Ref: ${refId}`,
    });

    while (true) {
      const meta = await fetchDataMeta(refId);
      const rows = meta.rows ?? 0;

      if (lastRows === null) {
        lastRows = rows;
      } else if (rows === lastRows) {
        stableHits += 1;
        if (stableHits >= STABLE_CHECKS) {
          return { rows, columns: meta.columns ?? [] };
        }
      } else {
        addLog('debug', `Output still growing for "${stepLabel}": ${lastRows} -> ${rows} rows`, {
          stepId,
          stepLabel,
          operationId,
        });
        lastRows = rows;
        stableHits = 0;
      }

      if ((performance.now() - startedAt) >= STABLE_TIMEOUT_MS) {
        addLog('warn', `Stability timeout for "${stepLabel}"; proceeding with latest output`, {
          stepId,
          stepLabel,
          operationId,
          detail: `Rows: ${rows}`,
        });
        return { rows, columns: meta.columns ?? [] };
      }

      await sleep(STABLE_POLL_MS);
    }
  }, [addLog]);

  // Wrapper that keeps the ref in sync *immediately* (not after re-render)
  const setPipelineStatus = useCallback((s: 'idle' | 'running' | 'paused') => {
    pipelineStatusRef.current = s;
    _setPipelineStatus(s);
  }, []);

  function addStepAt(index: number, label?: string) {
    const newStep: Step = {
      id: genId('step'),
      sequence_index: index,
      label: label || `Step ${index}`,
      formula: '',
      process_type: 'noop',
      configuration: {},
      status: 'pending',
    };

    announce({
      kind: 'add',
      name: newStep.label,
      after: index > 0 ? `step${index}` : null,
    });

    // Functional form, not `workflow` from the render closure. dispatchCommand
    // is memoised and captures this function, so a closure read here served a
    // workflow snapshot from before the last run — adding a step from the
    // console reverted completed steps to pending and dropped their output.
    const insert = (wf: Workflow): Workflow => {
      const newSteps = [...wf.steps];
      newSteps.splice(index, 0, newStep);
      return { ...wf, steps: newSteps.map((s, i) => ({ ...s, sequence_index: i })) };
    };
    // The ref too, now: commands applied in a row (an agent proposal, a pasted
    // console script) address this step before React re-renders.
    workflowRef.current = insert(workflowRef.current);
    setWorkflow(insert);
    setExpandedStepIds(prev => new Set(prev).add(newStep.id));
    return newStep.id;
  }

  function toggleStep(id: string) {
    setExpandedStepIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (maximizedStepId === id) setMaximizedStepId(null);
      } else {
        next.add(id);
        unminimize(id);
      }
      return next;
    });
  }

  function toggleMaximizeStep(id: string) {
    if (maximizedStepId === id) {
      setMaximizedStepId(null);
    } else {
      setExpandedStepIds(prev => new Set(prev).add(id));
      setMaximizedStepId(id);
      unminimize(id);
    }
  }

  /** Hide the step's UI and shrink its header to fit its name. */
  function minimizeStep(id: string) {
    collapseStep(id);
    setMinimizedStepIds(prev => new Set(prev).add(id));
  }

  function collapseStep(id: string) {
    setExpandedStepIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (maximizedStepId === id) setMaximizedStepId(null);
  }

  const runStep = useCallback(async (id: string, config?: Record<string, unknown>) => {
    // Announce only a directly requested run. runPipeline drives this same
    // function per step and announces once for the whole pipeline, so without
    // this guard a 5-step run would emit six commands.
    if (pipelineStatusRef.current !== 'running') {
      announce({ kind: 'run', target: stepAlias(id) });
    }
    // Use the ref to always get the LATEST workflow state — critical for pipeline
    // sequential execution where React state updates may not have flushed yet.
    const currentSteps = workflowRef.current.steps;
    const step = currentSteps.find((s) => s.id === id);
    if (!step) return;

    // ── Derive operation_id and args from the formula (the canonical source) ──
    // If a config override is explicitly passed (e.g. from runPipeline), use it
    // as-is. Otherwise, always parse the formula to get the authoritative args.
    const parsed = step.formula ? await parseFormula(step.formula) : null;
    const operationId = (parsed?.isValid && parsed.operationId)
      ? parsed.operationId
      : step.process_type;

    // Internal (_-prefixed) keys like _orchestrator are not in the formula —
    // carry them from configuration. Formula args override everything else.
    // When formula parsing fails (e.g. old saves without formula), fall back
    // to the full configuration so parameters like channel_url are not lost.
    const internalKeys = Object.fromEntries(
      Object.entries(step.configuration).filter(([k]) => k.startsWith('_'))
    );
    const formulaArgs = (parsed?.isValid && parsed.args) ? parsed.args : {};
    const hasFormulaArgs = Object.keys(formulaArgs).length > 0;
    const resolvedConfig: Record<string, unknown> = config ?? (
      hasFormulaArgs
        ? { ...internalKeys, ...formulaArgs }
        : { ...step.configuration }  // fall back to full config if formula parse yielded nothing
    );

    // Identify dependency (previous step)
    const stepIndex = currentSteps.indexOf(step);
    const prevStep = stepIndex > 0 ? currentSteps[stepIndex - 1] : undefined;
    
    // Build Step Map — keyed by step ID, label, and positional alias (step1, step2…)
    // This is sent to the backend so resolve_reference() can look up any token
    // the wiring UI inserts (e.g. "step-abc123.url" or "Step 0.url").
    const stepMap: Record<string, string> = {};
    for (const [index, s] of currentSteps.entries()) {
        if (s.outputRefId) {
            stepMap[s.id] = s.outputRefId;           // exact step ID  (primary key for wiring)
            stepMap[s.label] = s.outputRefId;         // human label
            stepMap[`step${index + 1}`] = s.outputRefId; // positional alias
        }
    }

    // ── Log: Step starting ──
    const startTime = performance.now();
    addLog('info', `Running step "${step.label}" with operation "${operationId}"`, {
      stepId: id,
      stepLabel: step.label,
      operationId,
      detail: `Config: ${JSON.stringify(resolvedConfig, null, 2)}\nInput Ref: ${prevStep?.outputRefId ?? '(none)'}\nStep Map keys: ${Object.keys(stepMap).join(', ') || '(empty)'}`,
    });

    {
      const latest = workflowRef.current;
      const next = latest.steps.map((s) => (s.id === id ? { ...s, status: 'running' as const } : s));
      const updated = { ...latest, steps: next };
      workflowRef.current = updated;
      setWorkflow(updated);
    }

    // Start SSE progress listener
    const stopListening = listenProgress(
      id,
      (evt) => setStepProgress((prev) => ({ ...prev, [id]: evt })),
      () => setStepProgress((prev) => { const { [id]: _unused, ...rest } = prev; void _unused; return rest; }),
    );

    try {
      // An expression that doesn't parse fails here, as one error cell —
      // never by running the step's previous operation.
      assertFormulaParses(step.formula, parsed);
      // Execute the step — use operationId and resolvedConfig derived from the formula
      const res = await runStepApi(
          id, 
          operationId, 
          resolvedConfig, 
          prevStep?.outputRefId ?? null,
          stepMap,
          false,
          step.formula || undefined,
          // Session is server-issued via the ss_session HttpOnly cookie —
          // we never send a sessionId from JS.  Previously this slot
          // passed `workflowRef.current.id` (the saved-pipeline slug),
          // which conflated "saved artifact" with "running tab" and
          // caused data leaks between concurrent users of the same file.
          undefined,
          workflowRef.current.resources,
          workflowKey(),
          workflowDecl(),
      );

          const stableMeta = await waitForStableOutput(res.output_ref_id, id, step.label, operationId);
      
      const elapsed = Math.round(performance.now() - startTime);

      // The cells come from core's view of the step (states, types, row ids),
      // fetched when the run's step states arrive below (refreshViews).
      const outputCols: string[] = stableMeta.columns.length > 0
        ? stableMeta.columns
        : (res.metrics.columns ?? []);
      const newCols = outputCols.filter((c) => !(prevStep?.outputColumns ?? []).includes(c));

      // ── Log: Step succeeded ──
      addLog('success', `Step "${step.label}" completed — ${stableMeta.rows} rows, ${outputCols.length} columns`, {
        stepId: id,
        stepLabel: step.label,
        operationId,
        durationMs: elapsed,
        detail: `Output Ref: ${res.output_ref_id}\nColumns: ${outputCols.join(', ')}\nNew columns: ${newCols.join(', ') || '(none)'}`
          + (res.metrics.engine === 'grid' ? `\nCore: ${res.metrics.verb} · ${res.metrics.units ?? '?'} units` : ''),
      });

      // Valid, but probably not what was meant: an argument overriding a
      // column, an output replacing one (spec 009 REQ-RUN-002).
      const warnings = res.metrics.warnings ?? [];
      if (warnings.length) {
        addLog('warn', `Step "${step.label}": ${warnings.length === 1 ? 'a warning' : `${warnings.length} warnings`} from core`, {
          stepId: id,
          stepLabel: step.label,
          operationId,
          detail: warnings.join('\n'),
        });
      }

      // Core records a failing row instead of failing the step: say so, with
      // the errors, rather than letting None cells pass as results.
      if (res.metrics.failed) {
        addLog('warn', `Step "${step.label}": ${res.metrics.failed} of ${res.metrics.units ?? '?'} units failed`, {
          stepId: id,
          stepLabel: step.label,
          operationId,
          detail: (res.metrics.errors ?? []).map((e) => `row ${e.unit}: ${e.error}`).join('\n'),
        });
      }

      {
        const latest = workflowRef.current;
        const next = latest.steps.map((s) => {
          if (s.id !== id) return s;
          return {
            ...s,
            status: 'completed' as StepStatus,
            outputRefId: res.output_ref_id,
            outputRows: stableMeta.rows,
            outputColumns: outputCols,
            warnings,
            uncaughtFailed: res.metrics.uncaught_failed ?? 0,
          };
        });
        const updated = { ...latest, steps: next };
        workflowRef.current = updated;
        setWorkflow(updated);
      }

      // Steps this one reads that hadn't run in this session ran first, on
      // the server: show their outputs too.
      await showOutputs(res.metrics.outputs);
      for (const name of Object.keys(res.metrics.outputs ?? {})) {
        addLog('info', `Step "${name}" ran first: "${step.label}" reads it`, { stepLabel: name });
      }
      // Which steps are out of date now, as core sees it.
      applyStepStates(res.metrics.steps);
      return 'completed';
    } catch (error) {
      const elapsed = Math.round(performance.now() - startTime);
      console.error(error);

      // ── Log: Step failed ──
      const backendErr = (error as { backendError?: BackendError })?.backendError;
      const errorMessage = backendErr?.detail || (error instanceof Error ? error.message : String(error));
      const errorDetail = [
        backendErr?.error_type ? `Error Type: ${backendErr.error_type}` : null,
        `Message: ${errorMessage}`,
        backendErr?.traceback ? `\nBackend Traceback:\n${backendErr.traceback}` : null,
        `\nConfig sent: ${JSON.stringify(resolvedConfig, null, 2)}`,
      ].filter(Boolean).join('\n');

      addLog('error', `Step "${step.label}" failed: ${errorMessage}`, {
        stepId: id,
        stepLabel: step.label,
        operationId,
        durationMs: elapsed,
        detail: errorDetail,
      });

      {
        // The step has no valid output: show the error as its one cell, and
        // drop the previous output so later steps can't read stale data.
        const latest = workflowRef.current;
        const next = latest.steps.map((s) => (s.id === id ? {
          ...s,
          status: 'error' as const,
          output_preview: [errorCell(errorMessage)],
          outputRefId: undefined,
          outputRows: undefined,
          outputColumns: undefined,
          warnings: undefined,
          uncaughtFailed: undefined,
        } : s));
        const updated = { ...latest, steps: next };
        workflowRef.current = updated;
        setWorkflow(updated);
      }
      throw error;
    } finally {
      stopListening();
    }
  }, [addLog, waitForStableOutput]);

  /**
   * Preview a step: core's view of it, run or not, as core's `wf.preview` —
   * the workflow is declared and the step shows its planned or current cells.
   * Nothing runs (dev_plan/126 D3); only Run, or ⌘/Ctrl+Enter, runs a step.
   * It used to run the step in full, on every Formula panel edit: the
   * backend never honoured its `is_preview`.
   */
  const previewStep = useCallback(async (id: string) => {
    announce({ kind: 'preview', target: stepAlias(id) });
    declareWorkflow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declareWorkflow]);

  /**
   * Run the pipeline to the end. With `fromId` (a step toolbar's "Run to the
   * end"), that step and every later one run, after any earlier step that
   * hasn't run yet; without it, from the first step not yet run.
   */
  const runPipeline = useCallback((fromId?: unknown) => {
    if (pipelineStatusRef.current === 'running') return;
    announce({ kind: 'run', target: null });

    setPipelineStatus('running');
    const steps = workflowRef.current.steps;
    const firstIncomplete = steps.findIndex(s => s.status !== 'completed');
    // A button wired straight to this passes its click event, so only a string is a step.
    const from = typeof fromId === 'string' ? steps.findIndex(s => s.id === fromId) : -1;
    const startIndex = from >= 0
      ? (firstIncomplete >= 0 ? Math.min(firstIncomplete, from) : from)
      : (firstIncomplete >= 0 ? firstIncomplete : 0);

    addLog('info', `▶ Pipeline started — running ${steps.length - startIndex} step(s) from index ${startIndex}`, {
      detail: `Steps: ${steps.slice(startIndex).map(s => s.label).join(' → ')}`,
    });

    void (async () => {
      // Stage: tracks every step output that has been committed and is safe to
      // use as input for downstream steps.  Keyed by step ID.
      // Only a successfully-completed step's outputRefId is added here.
      const staged = new Map<string, string>(); // stepId → outputRefId

      // Pre-populate stage with already-completed steps so resume works.
      for (const s of workflowRef.current.steps) {
        if (s.status === 'completed' && s.outputRefId) {
          staged.set(s.id, s.outputRefId);
        }
      }

      try {
        for (let i = startIndex; i < workflowRef.current.steps.length; i += 1) {
          if (pipelineStatusRef.current !== 'running') break;

          const liveStep = workflowRef.current.steps[i];
          if (!liveStep) break;

          // ── Check stage before running ──────────────────────────────────
          // If this is not the first step, the previous step's output must be
          // staged.  If it isn't (because that step failed or was skipped),
          // we refuse to run against missing upstream data.
          if (i > 0) {
            const prevStep = workflowRef.current.steps[i - 1];
            if (prevStep && !staged.has(prevStep.id)) {
              addLog('warn', `Skipping "${liveStep.label}" — upstream step "${prevStep.label}" did not produce staged output`, {
                stepId: liveStep.id,
                stepLabel: liveStep.label,
                operationId: liveStep.process_type,
                detail: `Stage contains: [${[...staged.keys()].join(', ')}]`,
              });
              // Mark as error so it's visible in the UI
              setWorkflow(prev => ({
                ...prev,
                steps: prev.steps.map(s =>
                  s.id === liveStep.id ? { ...s, status: 'error' as const } : s
                ),
              }));
              break; // stop pipeline — data is missing
            }
          }

          addLog('info', `Queued next step "${liveStep.label}"`, {
            stepId: liveStep.id,
            stepLabel: liveStep.label,
            operationId: liveStep.process_type,
            detail: `Pipeline index ${i + 1}/${workflowRef.current.steps.length} | Staged outputs: [${[...staged.keys()].join(', ')}]`,
          });

          await runStep(liveStep.id);

          // ── Commit to stage on success ──────────────────────────────────
          // runStep updates workflowRef on success and sets outputRefId.
          // Read it back from the live ref and add it to the stage.
          const completedStep = workflowRef.current.steps[i];
          // Core's rule (spec 009 REQ-RUN-004): a failed row stops the run
          // unless the step lets it through with mod.try_except. The step
          // keeps its output, so its failed cells can be inspected.
          if (completedStep?.status === 'completed' && (completedStep.uncaughtFailed ?? 0) > 0) {
            const notRun = workflowRef.current.steps.slice(i + 1).map((s) => s.label);
            addLog('error', `Run stopped at "${completedStep.label}": ${completedStep.uncaughtFailed} row(s) failed`, {
              stepId: completedStep.id,
              stepLabel: completedStep.label,
              operationId: completedStep.process_type,
              detail: `Not run: ${notRun.join(', ') || '(none)'}\n`
                + 'Add mod.try_except(…) to the step to let these failures through, '
                + 'or mod.try_except(default=…) to use a value instead.',
            });
            break;
          }
          if (completedStep?.outputRefId && completedStep.status === 'completed') {
            staged.set(completedStep.id, completedStep.outputRefId);
            addLog('debug', `Staged output for "${completedStep.label}"`, {
              stepId: completedStep.id,
              stepLabel: completedStep.label,
              operationId: completedStep.process_type,
              detail: `Ref: ${completedStep.outputRefId} | Stage size: ${staged.size}`,
            });
          }
        }

        if (pipelineStatusRef.current === 'running') {
          setPipelineStatus('idle');
        }
      } catch {
        setPipelineStatus('idle');
      }
    })();
  }, [runStep, addLog, setPipelineStatus]);

  const pausePipeline = useCallback(() => {
    if (pipelineStatusRef.current !== 'running') return;
    setPipelineStatus('paused');
  }, [setPipelineStatus]);

  const stopPipeline = useCallback(() => {
    setPipelineStatus('idle');
    setWorkflow(prev => {
        const next = prev.steps.map(s => {
             // Reset running to suspended/error or keep as is?
             // Usually Stop means "Abort".
             if (s.status === 'running') return { ...s, status: 'stopped' as const };
             // Do we reset others? Keeping completed is good.
             return s;
        });
        return { ...prev, steps: next };
    });
  }, [setPipelineStatus]);

  // ── Resources ────────────────────────────────────────────────────────────
  // A workflow's resources live in its `resources` section, never in a step
  // (122 §2.4). The toolbar's Resources menu and the console both come here.

  /** Create or change resource *name* from `Type(setting=…)`. The backend
   *  checks it with core first, so a bad setting never reaches the file. */
  const defineResource = useCallback(async (name: string, definition: string): Promise<void> => {
    const { name: clean, declaration } = await declareResource(name, definition);
    announce({ kind: 'define_resource', name: clean, definition: definition.trim() });
    const latest = workflowRef.current;
    const updated = { ...latest, resources: { ...(latest.resources ?? {}), [clean]: declaration } };
    workflowRef.current = updated;      // so a run straight after sees it
    setWorkflow(updated);
  }, [announce]);

  /** Delete resource *name*. Refused while a step uses it, listing those steps. */
  const removeResource = useCallback((name: string): void => {
    const latest = workflowRef.current;
    if (!latest.resources || !(name in latest.resources)) {
      throw new Error(`No resource named '${name}'.`);
    }
    const users = stepsUsingResource(latest.steps, name);
    if (users.length) {
      throw new Error(`res["${name}"] is used by ${users.join(', ')}. Change those steps first.`);
    }
    announce({ kind: 'remove_resource', name });
    const { [name]: _removed, ...rest } = latest.resources;
    void _removed;
    const updated = { ...latest, resources: rest };
    workflowRef.current = updated;
    setWorkflow(updated);
  }, [announce]);

  /**
   * Move a step to *index* (0 the first). The workflow is synced at once, so
   * core moves it too (`k.move`, kernels.sync) and marks what an order change
   * makes stale or invalid — a step moved above what it reads, say.
   */
  function moveStep(id: string, index: number) {
    const steps = workflowRef.current.steps;
    const from = steps.findIndex((s) => s.id === id);
    const to = Math.max(0, Math.min(steps.length - 1, index));
    if (from < 0 || from === to) return;
    announce({ kind: 'move', target: stepAlias(id), to });
    const next = [...steps];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    workflowRef.current = { ...workflowRef.current, steps: next.map((s, i) => ({ ...s, sequence_index: i })) };
    setWorkflow(workflowRef.current);
    scheduleSync(0);
  }

  function deleteStep(id: string) {
    announce({ kind: 'remove', target: stepAlias(id) });
    const drop = (wf: Workflow): Workflow => ({
      ...wf,
      steps: wf.steps.filter((s) => s.id !== id).map((s, i) => ({ ...s, sequence_index: i })),
    });
    workflowRef.current = drop(workflowRef.current);
    setWorkflow(drop);
    scheduleSync();
    setExpandedStepIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
    });
  }

  function updateStep(id: string, updates: Partial<Step>) {
    // `formula` and `label` are intent; everything else in a Partial<Step>
    // (status, outputRefId, outputRows, output_preview) is a consequence of a
    // run and must not reach the transcript.
    if (updates.formula !== undefined) {
      announce({ kind: 'set', target: stepAlias(id), formula: updates.formula });
    }
    if (updates.label !== undefined) {
      const before = workflowRef.current.steps.find((s) => s.id === id)?.label;
      if (before !== undefined && before !== updates.label) {
        announce({ kind: 'rename', target: stepAlias(id), to: updates.label });
      }
    }
    const patch = (wf: Workflow): Workflow => ({
      ...wf,
      steps: wf.steps.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    });
    workflowRef.current = patch(workflowRef.current);
    setWorkflow(patch);
    // An edit can put later steps out of date: ask core which.
    if (updates.formula !== undefined || updates.label !== undefined) scheduleSync();
  }

  // --- Persistence ---

  /**
   * Replaces the current workflow with any Workflow object (e.g. a demo pipeline).
   * Steps are reset to 'pending' — no runtime data is carried over.
   */
  const loadWorkflowObject = useCallback((wf: Workflow) => {
    const reset: Workflow = {
      ...wf,
      steps: wf.steps.map((s) => ({
        ...s,
        status: 'pending' as StepStatus,
        outputRefId: undefined,
        output_preview: undefined,
        viewKey: undefined,
      })),
    };
    setWorkflow(reset);
    setExpandedStepIds(new Set(reset.steps.length > 0 ? [reset.steps[0].id] : []));
    setMaximizedStepId(null);
    setPipelineStatus('idle');
  }, [setPipelineStatus]);

  /**
   * Save the current workflow as a pipeline file inside a project folder.
   * Only the operation definitions and configs are persisted — no runtime data.
   * The pipeline id is derived from the name so the filename on disk always
   * matches the id we store in the tab (no UUID/slug mismatch).
   */
  /**
   * Save the current workflow as `pipelineName` in `projectId`.
   *
   * `pipelineId` pins the file to write (an already-open workflow keeps its
   * file even after a rename); without it the id is derived from the name.
   * `overwrite: false` rejects with `WorkflowExistsError` if that file exists.
   */
  const saveWorkflow = useCallback(async (
    projectId: string,
    pipelineName: string,
    { pipelineId: fixedId, overwrite = true }: { pipelineId?: string; overwrite?: boolean } = {},
  ): Promise<PipelineFile> => {
    const current = workflowRef.current;
    // Derive a stable slug from the name so filename === id
    const pipelineId = fixedId || pipelineName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'pipeline';

    const pipeline: PipelineFile = {
      // Sections this app doesn't edit go back exactly as they were loaded.
      ...(current.sections ?? {}),
      ...(current.meta ? { meta: current.meta } : {}),
      ...(current.resources ? { resources: current.resources } : {}),
      id: pipelineId,
      name: pipelineName,
      created_at: current.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
      steps: current.steps.map((s) => ({
        step_id: s.id,
        operation_id: s.process_type,
        label: s.label,
        config: s.configuration,
        // formula is the canonical field — always persisted
        formula: s.formula ?? s.operation ?? '',
        // What the formula can't carry: the step's colour and notes.
        ...((s.step_color || s.notes) ? {
          meta: {
            ...(s.step_color ? { step_color: s.step_color } : {}),
            ...(s.notes ? { notes: s.notes } : {}),
          },
        } : {}),
      })),
    };
    return savePipeline(projectId, pipeline, { overwrite });
  }, []);

  /** Load a pipeline from a project and replace the current workflow. */
  const loadWorkflow = useCallback(async (projectId: string, pipelineId: string): Promise<void> => {
    const pipeline = await loadPipeline(projectId, pipelineId);
    const restoredSteps: Step[] = await Promise.all(pipeline.steps.map(hydrateStep));
    setWorkflow({ ...fileSections(pipeline), steps: restoredSteps });
    setExpandedStepIds(new Set(restoredSteps.length > 0 ? [restoredSteps[0].id] : []));
    setMaximizedStepId(null);
    setPipelineStatus('idle');
  }, [setPipelineStatus]);

  /** Fetch a pipeline as a Workflow object WITHOUT changing hook state. */
  const fetchWorkflow = useCallback(async (projectId: string, pipelineId: string): Promise<Workflow> => {
    const pipeline = await loadPipeline(projectId, pipelineId);
    const steps: Step[] = await Promise.all(pipeline.steps.map(hydrateStep));
    return { ...fileSections(pipeline), steps };
  }, []);

  const listSavedProjects = useCallback(() => listProjects(), []);
  const createNewProject  = useCallback((name: string) => createProject(name), []);
  const removeProject     = useCallback((id: string)   => deleteProject(id), []);
  const listProjectPipelines = useCallback((projectId: string) => listPipelines(projectId), []);
  const removePipeline    = useCallback((projectId: string, pipelineId: string) => deletePipeline(projectId, pipelineId), []);

  // ── Console → GUI ────────────────────────────────────────────────────────
  /**
   * Apply a command that came from the console.
   *
   * Every branch calls the *same* mutator a click calls. That is what makes
   * parity structural rather than mirrored: there is one path into workflow
   * state, so the two directions cannot drift apart. The only difference is
   * `commandOrigin`, which tags the emitted record so the transcript shows
   * where the command came from.
   *
   * Returns a human-readable confirmation, or throws with a usable message.
   */
  const dispatchCommand = useCallback(async (
    cmd: WorkflowCommand,
    origin: 'console' | 'agent' = 'console',
  ): Promise<string> => {
    const prevOrigin = commandOrigin.current;
    commandOrigin.current = origin;
    try {
      const need = (name: string): string => {
        const id = resolveStepId(name);
        if (!id) {
          const known = workflowRef.current.steps.map((_, i) => `step${i + 1}`).join(', ');
          throw new Error(`No step named '${name}'. Known steps: ${known || '(none)'}`);
        }
        return id;
      };

      switch (cmd.kind) {
        case 'set': {
          const id = need(cmd.target);
          // Route through the formula path so process_type and configuration
          // are re-derived exactly as a formula-bar edit would derive them.
          const parsed = await parseFormula(cmd.formula);
          const updates: Partial<Step> = { formula: cmd.formula, operation: cmd.formula };
          if (parsed.isValid && parsed.operationId) {
            updates.process_type = parsed.operationId;
            updates.configuration = { ...parsed.args };
          } else if (cmd.formula && !cmd.formula.startsWith('=')) {
            updates.process_type = 'passthrough';
            updates.configuration = { _ref: cmd.formula };
          }
          updateStep(id, updates);
          return `${cmd.target} = ${cmd.formula}`;
        }
        case 'add': {
          // Hoisted so the narrowing survives into the callback below.
          const after = cmd.after ?? null;
          const anchorId = after ? need(after) : null;
          const index = anchorId
            ? workflowRef.current.steps.findIndex((st) => st.id === anchorId) + 1
            : workflowRef.current.steps.length;
          addStepAt(index, cmd.name);
          return cmd.name ? `added ${cmd.name}` : `added step${index + 1}`;
        }
        case 'remove': {
          const id = need(cmd.target);
          deleteStep(id);
          return `removed ${cmd.target}`;
        }
        case 'rename': {
          const id = need(cmd.target);
          updateStep(id, { label: cmd.to });
          return `${cmd.target} renamed to '${cmd.to}'`;
        }
        case 'move': {
          const id = need(cmd.target);
          moveStep(id, cmd.to);
          return `${cmd.target} moved to position ${cmd.to}`;
        }
        case 'run': {
          if (cmd.target === null) { runPipeline(); return 'pipeline started'; }
          const id = need(cmd.target);
          await runStep(id);
          return `ran ${cmd.target}`;
        }
        case 'preview': {
          const id = need(cmd.target);
          await previewStep(id);
          return `previewed ${cmd.target}`;
        }
        case 'define_resource': {
          await defineResource(cmd.name, cmd.definition);
          return `res["${cmd.name}"] = ${cmd.definition}`;
        }
        case 'remove_resource': {
          removeResource(cmd.name);
          return `removed res["${cmd.name}"]`;
        }
      }
    } finally {
      commandOrigin.current = prevOrigin;
    }
  }, [resolveStepId, runStep, previewStep, runPipeline, defineResource, removeResource]);

  /** The step_map the console sends with an expression, so the backend
   *  namespace matches what the GUI is showing. Same shape as a run's. */
  const consoleStepMap = useCallback((): Record<string, string> => {
    const map: Record<string, string> = {};
    workflowRef.current.steps.forEach((st, i) => {
      if (st.outputRefId) {
        map[st.id] = st.outputRefId;
        map[st.label] = st.outputRefId;
        map[`step${i + 1}`] = st.outputRefId;
      }
    });
    return map;
  }, []);

  return { 
    workflow, 
    availableOperations,
    expandedStepIds, 
    pipelineStatus,
    maximizedStepId,
    stepProgress,
    addStepAt, 
    toggleStep, 
    toggleMaximizeStep,
    minimizedStepIds,
    minimizeStep,
    collapseStep, 
    updateStep,
    dispatchCommand,
    consoleStepMap,
    resolveStepId,
    runStep,
    declareWorkflow, 
    previewStep,
    runPipeline,
    pausePipeline,
    stopPipeline,
    deleteStep,
    moveStep,
    // resources (the workflow's `resources` section)
    defineResource,
    removeResource,
    // execution log
    executionLogs,
    clearLogs,
    // persistence
    saveWorkflow,
    loadWorkflow,
    fetchWorkflow,
    loadWorkflowObject,
    listSavedProjects,
    createNewProject,
    removeProject,
    listProjectPipelines,
    removePipeline,
  };
}

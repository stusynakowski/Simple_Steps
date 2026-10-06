import { useState, useRef, useEffect, useCallback } from 'react';
import type { Workflow, Step, StepStatus, Cell } from '../types/models';
import { initialWorkflow } from '../mocks/initialData';
import { runStep as runStepApi, fetchDataView, getOperations,
  listProjects, createProject, deleteProject,
  listPipelines, loadPipeline, savePipeline, deletePipeline,
  listenProgress,
  fetchDataMeta,
} from '../services/api';
import type { OperationDefinition, PipelineFile, BackendError, ProgressEvent } from '../services/api';
import { parseFormula, buildFormula } from '../utils/formulaParser';
import { errorCell, withRowErrors } from '../utils/errorCells';
import type { LogEntry, LogLevel } from '../components/ExecutionLog';
import type { WorkflowCommand } from '../types/commands';
import { formatCommand } from '../types/commands';
import { emitConsoleRecord } from '../context/ConsoleContext';

/**
 * Hydrate a saved StepConfig into a runtime Step.
 * The formula is the canonical field; process_type and configuration
 * are always re-derived from it so they stay in sync.
 *
 * Three scenarios handled:
 *   1. Valid formula saved  → derive process_type + configuration from it.
 *   2. No formula saved     → reconstruct from operation_id + config (legacy files).
 *   3. Invalid formula saved → ignore it, reconstruct from operation_id + config.
 */
async function hydrateStep(s: PipelineFile['steps'][number], i: number): Promise<Step> {
  const savedFormula = s.formula ?? '';
  const parsed = savedFormula ? await parseFormula(savedFormula) : null;
  const formulaIsUsable = parsed?.isValid && !!parsed.operationId;

  // If the saved file has a valid formula, derive everything from it.
  // Fall back to the legacy operation_id/config fields for old saves.
  const processType = formulaIsUsable
    ? parsed!.operationId!
    : (s.operation_id ?? 'noop');

  let formulaArgs = formulaIsUsable ? (parsed!.args ?? {}) : {};

  // Preserve internal (_-prefixed) keys from the saved config (e.g. _orchestrator)
  // that are not part of the formula syntax, then layer formula args on top.
  const internalKeys = Object.fromEntries(
    Object.entries(s.config ?? {}).filter(([k]) => k.startsWith('_'))
  );

  // When no valid formula exists (old save files), carry over ALL config keys
  // so parameters like channel_url, url_column etc. are not lost.
  const legacyConfig = (formulaIsUsable && Object.keys(formulaArgs).length > 0)
    ? {}
    : Object.fromEntries(
        Object.entries(s.config ?? {}).filter(([k]) => !k.startsWith('_'))
      );

  // --- Wire legacy saves to the previous step ---
  // Only for old saves with no usable formula. A formula says what it reads
  // (`over=readings`, `n=step1["n"]`) or is a source; injecting `data=stepN`
  // into it adds an argument the tool does not take.
  if (i > 0 && !formulaIsUsable) {
    const prevStepId = `step${i}`; // step1, step2, ... (1-based)
    // Only inject if no step reference is present in any arg
    const hasStepRef = Object.values(formulaArgs).some(v => typeof v === 'string' && v.startsWith('step'));
    if (!hasStepRef) {
      formulaArgs = { ...formulaArgs, data: `${prevStepId}` };
    }
  }

  const configuration = { ...internalKeys, ...legacyConfig, ...formulaArgs };

  // Use the saved formula only if it parsed successfully.
  // Otherwise reconstruct from legacy fields so the formula bar always
  // shows the correct function + arguments (not just the step name).
  // A usable saved formula is shown exactly as saved. Rebuilding it from its
  // parsed arguments loses what the arguments can't carry — references came
  // back quoted (`over="readings"`), and core's syntax
  // (`scale[mod.map()](wf["readings"])`) has no arguments to rebuild from.
  const formula = formulaIsUsable
    ? savedFormula
    : await buildFormula(processType, configuration,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (internalKeys._orchestrator as any) ?? null,
      );

  // --- Validate that all step references only point to previous steps ---
  // (Assume step references are of the form stepN or step-<id>)
  const stepRefPattern = /^step(\d+)(\.|$)/;
  Object.values(formulaArgs).forEach(v => {
    if (typeof v === 'string') {
      const match = v.match(stepRefPattern);
      if (match) {
        const refIdx = parseInt(match[1], 10);
        if (refIdx >= i + 1) {
          throw new Error(`Step ${i + 1} references a future or current step (step${refIdx}) in its formula, which is not allowed.`);
        }
      }
    }
  });

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
  const commandOrigin = useRef<'gui' | 'console'>('gui');

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

  function addStepAt(index: number) {
    const newStep: Step = {
      id: genId('step'),
      sequence_index: index,
      label: `Step ${index}`,
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
    setWorkflow((prev) => {
      const newSteps = [...prev.steps];
      newSteps.splice(index, 0, newStep);
      return { ...prev, steps: newSteps.map((s, i) => ({ ...s, sequence_index: i })) };
    });
    setExpandedStepIds(prev => new Set(prev).add(newStep.id));
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
      );

          const stableMeta = await waitForStableOutput(res.output_ref_id, id, step.label, operationId);
      
      const elapsed = Math.round(performance.now() - startTime);

      // Fetch preview — backend returns Cell[] directly ({row_id, column_id, value, display_value})
      const rawData: Cell[] = await fetchDataView(res.output_ref_id) as Cell[];

      // Determine which columns are NEW to this step.
      // Use prevStep.outputColumns (full accumulated column list), not output_preview (filtered).
      const inputCols = new Set(prevStep?.outputColumns ?? []);
      const outputCols: string[] = stableMeta.columns.length > 0
        ? stableMeta.columns
        : (res.metrics.columns ?? []);
      const newCols = outputCols.filter((c) => !inputCols.has(c));
      // Fall back to all output columns for source steps (no previous step)
      const displayCols = new Set(newCols.length > 0 ? newCols : outputCols);

      // rawData is already Cell[] — just filter to this step's own columns
      const previewCells = withRowErrors(
        rawData.filter((cell) => displayCols.has(cell.column_id)),
        res.metrics.row_errors,
        res.metrics.payload_column,
      );

      // ── Log: Step succeeded ──
      addLog('success', `Step "${step.label}" completed — ${stableMeta.rows} rows, ${outputCols.length} columns`, {
        stepId: id,
        stepLabel: step.label,
        operationId,
        durationMs: elapsed,
        detail: `Output Ref: ${res.output_ref_id}\nColumns: ${outputCols.join(', ')}\nNew columns: ${newCols.join(', ') || '(none)'}`
          + (res.metrics.engine === 'grid' ? `\nCore: ${res.metrics.verb} · ${res.metrics.units ?? '?'} units` : ''),
      });

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
            output_preview: previewCells,
          };
        });
        const updated = { ...latest, steps: next };
        workflowRef.current = updated;
        setWorkflow(updated);
      }
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

  const previewStep = useCallback(async (id: string, config?: Record<string, unknown>) => {
    announce({ kind: 'preview', target: stepAlias(id) });
     // Similar to runStep but with isPreview=true
    const currentSteps = workflowRef.current.steps;
    const step = currentSteps.find((s) => s.id === id);
    if (!step) return;

    const stepIndex = currentSteps.indexOf(step);
    const prevStep = stepIndex > 0 ? currentSteps[stepIndex - 1] : undefined;
    
    const stepMap: Record<string, string> = {};
    for (const [index, s] of currentSteps.entries()) {
        if (s.outputRefId) {
            stepMap[s.id] = s.outputRefId;
            stepMap[s.label] = s.outputRefId;
            stepMap[`step${index + 1}`] = s.outputRefId;
        }
    }

    // Derive operation_id and args from the formula (the canonical source)
    const parsed = step.formula ? await parseFormula(step.formula) : null;
    const previewOperationId = (parsed?.isValid && parsed.operationId)
      ? parsed.operationId
      : step.process_type;
    const internalKeys = Object.fromEntries(
      Object.entries(step.configuration).filter(([k]) => k.startsWith('_'))
    );
    const formulaArgs = (parsed?.isValid && parsed.args) ? parsed.args : {};
    const hasPreviewFormulaArgs = Object.keys(formulaArgs).length > 0;
    const previewConfig: Record<string, unknown> = config ?? (
      hasPreviewFormulaArgs
        ? { ...internalKeys, ...formulaArgs }
        : { ...step.configuration }
    );
    
    addLog('debug', `Preview requested for "${step.label}" (${previewOperationId})`, {
      stepId: id,
      stepLabel: step.label,
      operationId: previewOperationId,
    });

    try {
      assertFormulaParses(step.formula, parsed);
      const res = await runStepApi(
          id, 
          previewOperationId, 
          previewConfig, 
          prevStep?.outputRefId ?? null,
          stepMap,
          true, // isPreview
          step.formula || undefined,
          // No sessionId — see runStep above.  The cookie carries identity.
      );
      
      const rawData: Cell[] = await fetchDataView(res.output_ref_id) as Cell[];

      // Same column-diff logic as runStep — use outputColumns (full list), not output_preview
      const inputCols = new Set(prevStep?.outputColumns ?? []);
      const outputCols: string[] = res.metrics.columns ?? [];
      const newCols = outputCols.filter((c) => !inputCols.has(c));
      const displayCols = new Set(newCols.length > 0 ? newCols : outputCols);

      // rawData is already Cell[] — just filter to this step's own columns
      const previewCells = withRowErrors(
        rawData.filter((cell) => displayCols.has(cell.column_id)),
        res.metrics.row_errors,
        res.metrics.payload_column,
      );

      addLog('success', `Preview for "${step.label}" ready — ${res.metrics.rows} rows`, {
        stepId: id,
        stepLabel: step.label,
        operationId: previewOperationId,
      });

      setWorkflow((prev) => {
        const next = prev.steps.map((s) => {
          if (s.id !== id) return s;
          return {
            ...s,
            // We do NOT mark it as completed status, as it's just a preview/staged state.
            // But we DO update the outputRefId so that subsequent steps can preview off this one.
            outputRefId: res.output_ref_id,
            outputColumns: outputCols,
            output_preview: previewCells,
          };
        });
        return { ...prev, steps: next };
      });
    } catch (error) {
       const backendErr = (error as { backendError?: BackendError })?.backendError;
       const errorMessage = backendErr?.detail || (error instanceof Error ? error.message : String(error));
       addLog('warn', `Preview failed for "${step.label}": ${errorMessage}`, {
         stepId: id,
         stepLabel: step.label,
         operationId: previewOperationId,
         detail: backendErr?.traceback || undefined,
       });
       console.error("Preview failed", error);
       setWorkflow((prev) => ({
         ...prev,
         steps: prev.steps.map((s) => (s.id === id ? { ...s, output_preview: [errorCell(errorMessage)] } : s)),
       }));
    }
  }, [addLog]);

  const runPipeline = useCallback(() => {
    if (pipelineStatusRef.current === 'running') return;
    announce({ kind: 'run', target: null });
    
    setPipelineStatus('running');
    const steps = workflowRef.current.steps;
    const firstIncomplete = steps.findIndex(s => s.status !== 'completed');
    const startIndex = firstIncomplete >= 0 ? firstIncomplete : 0;

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

  function deleteStep(id: string) {
    announce({ kind: 'remove', target: stepAlias(id) });
    setWorkflow((prev) => {
      const newSteps = prev.steps.filter((s) => s.id !== id).map((s, i) => ({ ...s, sequence_index: i }));
      return { ...prev, steps: newSteps };
    });
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
    setWorkflow((prev) => {
      const nextSteps = prev.steps.map((s) => (s.id === id ? { ...s, ...updates } : s));
      return { ...prev, steps: nextSteps };
    });
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
  const saveWorkflow = useCallback(async (projectId: string, pipelineName: string): Promise<PipelineFile> => {
    const current = workflowRef.current;
    // Derive a stable slug from the name so filename === id
    const pipelineId = pipelineName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'pipeline';

    const pipeline: PipelineFile = {
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
      })),
    };
    return savePipeline(projectId, pipeline);
  }, []);

  /** Load a pipeline from a project and replace the current workflow. */
  const loadWorkflow = useCallback(async (projectId: string, pipelineId: string): Promise<void> => {
    const pipeline = await loadPipeline(projectId, pipelineId);
    const restoredSteps: Step[] = await Promise.all(pipeline.steps.map(hydrateStep));
    setWorkflow({
      id: pipeline.id,
      name: pipeline.name,
      created_at: pipeline.created_at,
      steps: restoredSteps,
    });
    setExpandedStepIds(new Set(restoredSteps.length > 0 ? [restoredSteps[0].id] : []));
    setMaximizedStepId(null);
    setPipelineStatus('idle');
  }, [setPipelineStatus]);

  /** Fetch a pipeline as a Workflow object WITHOUT changing hook state. */
  const fetchWorkflow = useCallback(async (projectId: string, pipelineId: string): Promise<Workflow> => {
    const pipeline = await loadPipeline(projectId, pipelineId);
    const steps: Step[] = await Promise.all(pipeline.steps.map(hydrateStep));
    return { id: pipeline.id, name: pipeline.name, created_at: pipeline.created_at, steps };
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
  const dispatchCommand = useCallback(async (cmd: WorkflowCommand): Promise<string> => {
    const prevOrigin = commandOrigin.current;
    commandOrigin.current = 'console';
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
          addStepAt(index);
          return `added step${index + 1}`;
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
      }
    } finally {
      commandOrigin.current = prevOrigin;
    }
  }, [resolveStepId, runStep, previewStep, runPipeline]);

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
    previewStep,
    runPipeline,
    pausePipeline,
    stopPipeline,
    deleteStep,
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

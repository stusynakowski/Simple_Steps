import { useState, useRef, useEffect, useCallback } from 'react';
import type { Workflow, Step, StepStatus } from '../types/models';
import { initialWorkflow } from '../mocks/initialData';
import { runStep as runStepApi, fetchDataView, getOperations,
  listProjects, createProject, deleteProject,
  listPipelines, loadPipeline, savePipeline, deletePipeline,
} from '../services/api';
import type { OperationDefinition, PipelineFile } from '../services/api';

function genId(prefix = 'step') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}
export default function useWorkflow() {
  const [workflow, setWorkflow] = useState<Workflow>(initialWorkflow);
  const [availableOperations, setAvailableOperations] = useState<OperationDefinition[]>([]);

  useEffect(() => {
    getOperations().then(setAvailableOperations).catch(console.error);
  }, []);

  const [expandedStepIds, setExpandedStepIds] = useState<Set<string>>(
    new Set(initialWorkflow.steps.length > 0 ? [initialWorkflow.steps[0].id] : [])
  );
  
  const [maximizedStepId, setMaximizedStepId] = useState<string | null>(null);
  
  const [pipelineStatus, setPipelineStatus] = useState<'idle' | 'running' | 'paused'>('idle');
  const pipelineStatusRef = useRef<'idle' | 'running' | 'paused'>('idle');

  // Sync ref with state
  useEffect(() => {
    pipelineStatusRef.current = pipelineStatus;
  }, [pipelineStatus]);

  function addStepAt(index: number) {
    const newStep: Step = {
      id: genId('step'),
      sequence_index: index,
      label: `Step ${index}`,
      process_type: 'noop',
      configuration: {},
      status: 'pending',
    };

    const newSteps = [...workflow.steps];
    newSteps.splice(index, 0, newStep);

    const reindexed = newSteps.map((s, i) => ({ ...s, sequence_index: i }));
    setWorkflow({ ...workflow, steps: reindexed });
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
    }
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
    // Locate the step in the current state to get parameters
    const currentSteps = workflow.steps; // Access latest state
    const step = currentSteps.find((s) => s.id === id);
    if (!step) return;

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

    setWorkflow((prev) => {
      const next = prev.steps.map((s) => (s.id === id ? { ...s, status: 'running' as const } : s));
      return { ...prev, steps: next };
    });

    try {
      // Execute the step using the step's process_type and configuration
      const res = await runStepApi(
          id, 
          step.process_type, 
          config ?? step.configuration, 
          prevStep?.outputRefId ?? null,
          stepMap
      );
      
      // Fetch preview — backend returns Cell[] directly ({row_id, column_id, value, display_value})
      const rawData: any[] = await fetchDataView(res.output_ref_id);

      // Determine which columns are NEW to this step.
      // Use prevStep.outputColumns (full accumulated column list), not output_preview (filtered).
      const inputCols = new Set(prevStep?.outputColumns ?? []);
      const outputCols: string[] = res.metrics.columns ?? [];
      const newCols = outputCols.filter((c) => !inputCols.has(c));
      // Fall back to all output columns for source steps (no previous step)
      const displayCols = new Set(newCols.length > 0 ? newCols : outputCols);

      // rawData is already Cell[] — just filter to this step's own columns
      const previewCells = rawData.filter((cell) => displayCols.has(cell.column_id));

      setWorkflow((prev) => {
        const next = prev.steps.map((s) => {
          if (s.id !== id) return s;
          return {
            ...s,
            status: 'completed' as StepStatus,
            outputRefId: res.output_ref_id,
            outputColumns: outputCols,
            output_preview: previewCells,
          };
        });
        return { ...prev, steps: next };
      });
      return 'completed';
    } catch (error) {
      console.error(error);
      setWorkflow((prev) => {
        const next = prev.steps.map((s) => (s.id === id ? { ...s, status: 'error' as const } : s));
        return { ...prev, steps: next };
      });
      throw error;
    }
  }, [workflow.steps]);

  const previewStep = useCallback(async (id: string, config?: Record<string, unknown>) => {
     // Similar to runStep but with isPreview=true
    const currentSteps = workflow.steps;
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
    
    // We don't set status to 'running' to avoid full UI lock, 
    // maybe just a subtle indicator if needed. 
    // For now, let's just run it "silently" and update the preview.

    try {
      const res = await runStepApi(
          id, 
          step.process_type, 
          config ?? step.configuration, 
          prevStep?.outputRefId ?? null,
          stepMap,
          true // isPreview
      );
      
      const rawData: any[] = await fetchDataView(res.output_ref_id);

      // Same column-diff logic as runStep — use outputColumns (full list), not output_preview
      const inputCols = new Set(prevStep?.outputColumns ?? []);
      const outputCols: string[] = res.metrics.columns ?? [];
      const newCols = outputCols.filter((c) => !inputCols.has(c));
      const displayCols = new Set(newCols.length > 0 ? newCols : outputCols);

      // rawData is already Cell[] — just filter to this step's own columns
      const previewCells = rawData.filter((cell) => displayCols.has(cell.column_id));

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
       console.error("Preview failed", error);
       // Don't change status to error on preview failure?
    }
  }, [workflow.steps]);

  const workflowRef = useRef(workflow);
  useEffect(() => {
    workflowRef.current = workflow;
  }, [workflow]);

  // Use a ref to access the latest runSequence function to avoid dependency cycles
  const runSequenceRef = useRef<(index: number) => Promise<void>>();

  const runSequence = useCallback(async (startIndex: number) => {
    // Check status at start of each iteration
    if (pipelineStatusRef.current !== 'running') {
        return; 
    }

    const currentWorkflow = workflowRef.current;
    if (startIndex >= currentWorkflow.steps.length) {
        setPipelineStatus('idle'); // Finished
        return;
    }

    const step = currentWorkflow.steps[startIndex];
    
    try {
        // We must pass the LATEST configuration from the ref, just in case
        await runStep(step.id, step.configuration);
        
        // After step finishes, check status again before creating next promise
        if (pipelineStatusRef.current === 'running') {
            // Recursive call using the ref
            if (runSequenceRef.current) {
                await runSequenceRef.current(startIndex + 1);
            }
        }
    } catch (e) {
        setPipelineStatus('idle'); // Stop on error
    }
  }, [runStep]); // Re-create when runStep changes

  // Update the ref whenever runSequence changes
  useEffect(() => {
    runSequenceRef.current = runSequence;
  }, [runSequence]);

  const runPipeline = useCallback(() => {
    if (pipelineStatusRef.current === 'running') return;
    
    setPipelineStatus('running');
    // Start from wherever we left off if paused, or from beginning?
    // Let's find first non-completed step
    let startIndex = 0;
    const steps = workflowRef.current.steps;
    const firstIncomplete = steps.findIndex(s => s.status !== 'completed');
    if (firstIncomplete >= 0) {
        startIndex = firstIncomplete;
    }

    runSequence(startIndex);
  }, [runSequence]);

  const pausePipeline = useCallback(() => {
    if (pipelineStatusRef.current !== 'running') return;
    setPipelineStatus('paused');
  }, []);

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
  }, []);

  function deleteStep(id: string) {
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
  }, []);

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
      })),
    };
    return savePipeline(projectId, pipeline);
  }, []);

  /** Load a pipeline from a project and replace the current workflow. */
  const loadWorkflow = useCallback(async (projectId: string, pipelineId: string): Promise<void> => {
    const pipeline = await loadPipeline(projectId, pipelineId);
    const restoredSteps: Step[] = pipeline.steps.map((s: PipelineFile['steps'][number], i: number) => ({
      id: s.step_id,
      sequence_index: i,
      label: s.label || `Step ${i + 1}`,
      process_type: s.operation_id,
      configuration: s.config as Record<string, unknown>,
      status: 'pending' as StepStatus,
    }));
    setWorkflow({
      id: pipeline.id,
      name: pipeline.name,
      created_at: pipeline.created_at,
      steps: restoredSteps,
    });
    setExpandedStepIds(new Set(restoredSteps.length > 0 ? [restoredSteps[0].id] : []));
    setMaximizedStepId(null);
    setPipelineStatus('idle');
  }, []);

  /** Fetch a pipeline as a Workflow object WITHOUT changing hook state. */
  const fetchWorkflow = useCallback(async (projectId: string, pipelineId: string): Promise<Workflow> => {
    const pipeline = await loadPipeline(projectId, pipelineId);
    const steps: Step[] = pipeline.steps.map((s: PipelineFile['steps'][number], i: number) => ({
      id: s.step_id,
      sequence_index: i,
      label: s.label || `Step ${i + 1}`,
      process_type: s.operation_id,
      configuration: s.config as Record<string, unknown>,
      status: 'pending' as StepStatus,
    }));
    return { id: pipeline.id, name: pipeline.name, created_at: pipeline.created_at, steps };
  }, []);

  const listSavedProjects = useCallback(() => listProjects(), []);
  const createNewProject  = useCallback((name: string) => createProject(name), []);
  const removeProject     = useCallback((id: string)   => deleteProject(id), []);
  const listProjectPipelines = useCallback((projectId: string) => listPipelines(projectId), []);
  const removePipeline    = useCallback((projectId: string, pipelineId: string) => deletePipeline(projectId, pipelineId), []);

  return { 
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
    previewStep,
    runPipeline,
    pausePipeline,
    stopPipeline,
    deleteStep,
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

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Workflow, Step, StepStatus } from '../types/models';
import { initialWorkflow } from '../mocks/initialData';
import { runStep as runStepApi, fetchDataView, getOperations } from '../services/api';
import type { OperationDefinition } from '../services/api';

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
    
    // Build Step Map (Label -> Output Ref ID)
    const stepMap: Record<string, string> = {};
    for (const s of currentSteps) {
        if (s.outputRefId) {
            stepMap[s.label] = s.outputRefId;
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
      
      // Fetch preview
      const rawData = await fetchDataView(res.output_ref_id);
      
      // Transform raw JSON rows into Cell format for the UI
      const previewCells = rawData.flatMap((row: any, rowIndex: number) => 
        Object.entries(row).map(([colName, val]) => ({
            row_id: rowIndex,
            column_id: colName,
            value: val,
            display_value: String(val)
        }))
      );

      setWorkflow((prev) => {
        const next = prev.steps.map((s) => {
          if (s.id !== id) return s;
          return {
            ...s,
            status: 'completed' as StepStatus,
            outputRefId: res.output_ref_id,
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
    for (const s of currentSteps) {
        if (s.outputRefId) {
            stepMap[s.label] = s.outputRefId;
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
      
      const rawData = await fetchDataView(res.output_ref_id);
      
      const previewCells = rawData.flatMap((row: any, rowIndex: number) => 
        Object.entries(row).map(([colName, val]) => ({
            row_id: rowIndex,
            column_id: colName,
            value: val,
            display_value: String(val)
        }))
      );

      setWorkflow((prev) => {
        const next = prev.steps.map((s) => {
          if (s.id !== id) return s;
          return {
            ...s,
            // We do NOT mark it as completed status, as it's just a preview/staged state.
            // But we DO update the outputRefId so that subsequent steps can preview off this one.
            outputRefId: res.output_ref_id,
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
    deleteStep 
  };
}

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
      label: 'New Step',
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
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function expandStep(id: string) {
    setExpandedStepIds(prev => new Set(prev).add(id));
  }

  function collapseStep(id: string) {
    setExpandedStepIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  const runStep = useCallback(async (id: string, config?: Record<string, unknown>) => {
    // Locate the step in the current state to get parameters
    const step = workflow.steps.find((s) => s.id === id);
    if (!step) return;

    // Identify dependency (previous step)
    const stepIndex = workflow.steps.indexOf(step);
    const prevStep = stepIndex > 0 ? workflow.steps[stepIndex - 1] : undefined;

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
          prevStep?.outputRefId ?? null
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

  const workflowRef = useRef(workflow);
  useEffect(() => {
    workflowRef.current = workflow;
  }, [workflow]);

  const runSequence = useCallback(async (startIndex: number) => {
    // Check status at start of each iteration
    if (pipelineStatusRef.current !== 'running') {
        return; 
    }

    const currentWorkflow = workflowRef.current;
    if (startIndex >= currentWorkflow.steps.length) {
        setPipelineStatus('idle');
        return;
    }

    const step = currentWorkflow.steps[startIndex];
    
    try {
        await runStep(step.id, step.configuration);
        
        // After step finishes, check status again before creating next promise
        if (pipelineStatusRef.current === 'running') {
            await runSequence(startIndex + 1);
        }
    } catch (e) {
        setPipelineStatus('idle'); // Stop on error
    }
  }, [runStep]);

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
    addStepAt, 
    toggleStep, 
    expandStep, 
    collapseStep, 
    updateStep,
    runStep, 
    runPipeline,
    pausePipeline,
    stopPipeline,
    deleteStep 
  };
}

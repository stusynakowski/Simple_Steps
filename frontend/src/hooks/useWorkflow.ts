import { useState } from 'react';
import type { Workflow, Step, StepStatus } from '../types/models';
import { initialWorkflow } from '../mocks/initialData';
import { runStep as runStepApi } from '../services/api';

function genId(prefix = 'step') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function useWorkflow() {
  const [workflow, setWorkflow] = useState<Workflow>(initialWorkflow);
  // Replaced single selected ID with a Set of expanded IDs
  const [expandedStepIds, setExpandedStepIds] = useState<Set<string>>(
    new Set(initialWorkflow.steps.length > 0 ? [initialWorkflow.steps[0].id] : [])
  );

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
    // Automatically expand the new step
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

  function runStep(id: string) {
    // mark running immediately
    setWorkflow((prev) => {
      const next = prev.steps.map((s) => (s.id === id ? { ...s, status: 'running' as const } : s));
      return { ...prev, steps: next };
    });

    const step = workflow.steps.find((s) => s.id === id);
    const config = step?.configuration ?? {};

    runStepApi(id, config)
      .then((res) => {
        setWorkflow((prev) => {
          const next = prev.steps.map((s) => {
            if (s.id !== id) return s;
            return {
              ...s,
              status: res.status as StepStatus,
              output_preview: res.output_preview ?? s.output_preview,
            };
          });
          return { ...prev, steps: next };
        });
      })
      .catch(() => {
        setWorkflow((prev) => {
          const next = prev.steps.map((s) => (s.id === id ? { ...s, status: 'error' as const } : s));
          return { ...prev, steps: next };
        });
      });
  }

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

  return { 
    workflow, 
    expandedStepIds, 
    addStepAt, 
    toggleStep, 
    expandStep, 
    collapseStep, 
    runStep, 
    deleteStep 
  };
}

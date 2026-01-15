import { useState } from 'react';
import type { Workflow, Step, StepStatus } from '../types/models';
import { initialWorkflow } from '../mocks/initialData';
import { runStep as runStepApi } from '../services/api';

function genId(prefix = 'step') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function useWorkflow() {
  const [workflow, setWorkflow] = useState<Workflow>(initialWorkflow);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(initialWorkflow.steps[0]?.id ?? null);

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
    setSelectedStepId(newStep.id);
  }

  function selectStep(id: string) {
    setSelectedStepId(id);
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
      // update selection if deleted
      setSelectedStepId((current) => (current === id ? (newSteps[0]?.id ?? null) : current));
      return { ...prev, steps: newSteps };
    });
  }

  return { workflow, selectedStepId, addStepAt, selectStep, runStep, deleteStep };
}

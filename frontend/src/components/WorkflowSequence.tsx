import StepIcon from './StepIcon';
import type { Step } from '../types/models';
import './WorkflowSequence.css';

interface WorkflowSequenceProps {
  steps: Step[];
  selectedStepId?: string | null;
  onSelect?: (id: string) => void;
  onAdd?: (index: number) => void;
}

export default function WorkflowSequence({ steps, selectedStepId, onSelect, onAdd }: WorkflowSequenceProps) {
  return (
    <div className="workflow-sequence" data-testid="workflow-sequence">
      {steps.map((step, index) => (
        <div key={step.id} className="sequence-slot">
          {index > 0 && (
            <button
              className="btn-add"
              aria-label={`Add step before ${index}`}
              data-testid={`btn-add-${index}`}
              onClick={() => onAdd?.(index)}
            >
              +
            </button>
          )}

          <StepIcon step={step} selected={selectedStepId === step.id} onClick={onSelect} />
        </div>
      ))}

      <div className="sequence-end">
        <button className="btn-add end" data-testid="btn-add-end" onClick={() => onAdd?.(steps.length)}>
          Add Step +
        </button>
      </div>
    </div>
  );
}

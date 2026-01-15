import type { Step } from '../types/models';

interface StepToolbarProps {
  step: Step;
  onRun?: (id: string) => void;
  onDelete?: (id: string) => void;
  onEdit?: (id: string) => void;
}

export default function StepToolbar({ step, onRun, onDelete, onEdit }: StepToolbarProps) {
  return (
    <div className="toolbar" data-testid="step-toolbar">
      <button data-testid="btn-run" onClick={() => onRun?.(step.id)}>
        {step.status === 'running' ? 'Stop' : 'Run'}
      </button>

      <button data-testid="btn-edit" onClick={() => onEdit?.(step.id)}>
        Edit Config
      </button>

      <button data-testid="btn-delete" onClick={() => onDelete?.(step.id)}>
        Delete
      </button>

      <div style={{ marginLeft: 'auto', color: '#444' }} data-testid="toolbar-meta">
        <span style={{ marginRight: 8 }} data-testid="toolbar-status">Status: {step.status}</span>
        <span data-testid="toolbar-type">Type: {step.process_type}</span>
      </div>
    </div>
  );
}

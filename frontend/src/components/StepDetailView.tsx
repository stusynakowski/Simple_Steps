import type { Step, Cell } from '../types/models';
import './StepDetailView.css';
import StepToolbar from './StepToolbar';
import DataOutputGrid from './DataOutputGrid';

interface StepDetailViewProps {
  step: Step | null;
  onRun?: (id: string) => void;
  onDelete?: (id: string) => void;
  onEdit?: (id: string) => void;
  onCellClick?: (cell: Cell) => void;
}

export default function StepDetailView({ step, onRun, onDelete, onEdit, onCellClick }: StepDetailViewProps) {
  if (!step) {
    return <div data-testid="step-detail-empty">No step selected</div>;
  }

  const preview = step.output_preview ?? [];

  return (
    <div data-testid="step-detail-content" className="step-detail-view">
      <div className="detail-header">
        <h3>{step.label}</h3>
        <div className="detail-meta">
          <div>Status: {step.status}</div>
          <div>Type: {step.process_type}</div>
        </div>
      </div>

      <StepToolbar step={step} onRun={onRun} onDelete={onDelete} onEdit={() => onEdit?.(step.id)} />

      <DataOutputGrid cells={preview} onCellClick={onCellClick} />
    </div>
  );
}

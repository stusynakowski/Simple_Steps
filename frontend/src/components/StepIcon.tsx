import type { Step } from '../types/models';
import './StepIcon.css';

interface StepIconProps {
  step: Step;
  selected?: boolean;
  onClick?: (id: string) => void;
}

export default function StepIcon({ step, selected = false, onClick }: StepIconProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`step-icon status-${step.status} ${selected ? 'selected' : ''}`}
      onClick={() => onClick?.(step.id)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick?.(step.id)}
      data-testid={`step-icon-${step.id}`}
    >
      <div className="step-label">{step.label}</div>
    </div>
  );
}

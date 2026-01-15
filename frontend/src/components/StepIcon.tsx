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
      <div className="chevron" aria-hidden>
        <svg width="18" height="28" viewBox="0 0 18 28" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M0 0L12 14L0 28V0Z" fill="currentColor" />
        </svg>
      </div>
    </div>
  );
}

import type { Step } from '../types/models';
import './StepIcon.css';

interface StepIconProps {
  step: Step;
  selected?: boolean;
  isMaximized?: boolean;
  onClick?: (id: string) => void;
  onMaximize?: (id: string) => void;
}

export default function StepIcon({ step, selected = false, isMaximized = false, onClick, onMaximize }: StepIconProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`step-icon status-${step.status} ${selected ? 'selected' : ''} ${isMaximized ? 'maximized' : ''}`}
      onClick={() => onClick?.(step.id)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick?.(step.id)}
      data-testid={`step-icon-${step.id}`}
    >
      <div className="step-label">{step.label}</div>
      {isMaximized && onMaximize && (
        <button
          type="button"
          className="step-icon-maximize-btn"
          aria-label={`Restore ${step.label}`}
          title="Restore Size"
          onClick={(event) => {
            event.stopPropagation();
            onMaximize(step.id);
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
          </svg>
        </button>
      )}
    </div>
  );
}

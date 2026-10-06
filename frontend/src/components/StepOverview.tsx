import type { Step } from '../types/models';
import type { OperationDefinition } from '../services/api';

/** The Analytics widget: what the step is and what it produced. */
export default function StepOverview({ step, availableOperations }: {
  step: Step;
  availableOperations: OperationDefinition[];
}) {
  const opDef = availableOperations.find(o => o.id === step.process_type);
  const opLabel = opDef?.label ?? step.process_type;
  const hasParams = Object.keys(step.configuration ?? {}).filter(k => !k.startsWith('_')).length > 0;
  const hasOutput = !!step.outputRefId && (step.outputColumns?.length ?? 0) > 0;
  const statusLabel: Record<string, string> = {
    pending: 'Queued', running: 'Running', completed: 'Completed',
    error: 'Error', paused: 'Paused', stopped: 'Stopped',
  };
  return (
    <div className="step-overview-panel">
      <div className="step-overview-grid">
        <span className="sop-key">Step</span>
        <span className="sop-val">{step.label}</span>

        <span className="sop-key">Operation</span>
        <span className="sop-val">{opLabel}</span>

        <span className="sop-key">Status</span>
        <span className={`sop-val sop-status sop-status--${step.status}`}>
          {statusLabel[step.status] ?? step.status}
        </span>

        <span className="sop-key">Execution ID</span>
        <span className="sop-val sop-mono">{step.id}</span>

        {hasParams && (
          <>
            <span className="sop-key">Parameters</span>
            <span className="sop-val sop-params">Configured</span>
          </>
        )}

        {hasOutput && (
          <>
            <span className="sop-key">Output</span>
            <span className="sop-val">
              <span className="sop-chip sop-rows">{(step.outputRows ?? 0).toLocaleString()} rows</span>
              <span className="sop-x">×</span>
              <span className="sop-chip sop-cols">{step.outputColumns!.length} cols</span>
              <span className="sop-x">=</span>
              <span className="sop-chip sop-cells">{((step.outputRows ?? 0) * step.outputColumns!.length).toLocaleString()} cells</span>
              <span className="sop-staged">staged</span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

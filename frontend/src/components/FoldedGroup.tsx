import type { RunState } from '../utils/runState';

/** One of a folded group's steps: a parallelogram in its colour. */
export interface FoldedStep { id: string; label: string; color: string; run: RunState }

/**
 * A folded group (dev_plan/141 §3.3): one header the shape of a step's, its
 * top half the group's band (GroupBand, drawn over it), its steps below as
 * parallelograms, each in its step's colour. Nothing shows under it: folding
 * a group folds its steps' tables with it. A click unfolds it; a click on
 * one of its steps unfolds it and opens that step, to run it alone.
 */
export default function FoldedGroup({ name, color, steps, zIndex, onUnfold, onOpenStep }: {
  name: string;
  color: string;
  steps: FoldedStep[];
  zIndex: number;
  onUnfold: () => void;
  onOpenStep: (id: string) => void;
}) {
  return (
    <div
      className="operation-column squeezed in-group folded-group"
      style={{ '--group-color': color, '--step-color': color, zIndex } as React.CSSProperties}
      data-testid={`folded-group-${name}`}
    >
      <div className="op-header" onClick={onUnfold} title={`${name}: ${steps.length} steps folded. Click to unfold`}>
        <div className="arrow-background" />
        <div className="folded-steps">
          {steps.map((s) => (
            <span
              key={s.id}
              className={`folded-step run-${s.run.kind}`}
              style={{ '--fill': s.color } as React.CSSProperties}
              title={`${s.label}: ${s.run.text}. Click to open it`}
              data-testid={`folded-step-${s.id}`}
              onClick={(e) => { e.stopPropagation(); onOpenStep(s.id); }}
            >
              <span className="folded-step-label">{s.label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

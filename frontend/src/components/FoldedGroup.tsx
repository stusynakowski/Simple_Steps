import type { ReactNode } from 'react';
import SymbolIcon from './SymbolIcon';
import { RUN_ICON, type RunState } from '../utils/runState';

/** One of a folded group's steps: a parallelogram in its colour. */
export interface FoldedStep { id: string; label: string; color: string; run: RunState }

/**
 * A folded group (dev_plan/141 §3.3): one header the shape of a step's, the
 * group's colour, name and controls on its top half, its steps below as
 * parallelograms, each in its step's colour. Nothing shows under it: folding
 * a group folds its steps' tables with it (a nested expander). A click on it
 * unfolds it, as a click on a step's header opens the step; a click on one
 * of its steps unfolds it and opens that step, to run it alone.
 */
export default function FoldedGroup({ name, color, run, steps, zIndex, controls, onUnfold, onOpenStep }: {
  name: string;
  color: string;
  run: RunState;
  steps: FoldedStep[];
  zIndex: number;
  /** The group's buttons (run options, notes, settings, fold), inline on its top half. */
  controls?: ReactNode;
  onUnfold: () => void;
  onOpenStep: (id: string) => void;
}) {
  return (
    <div
      className={`operation-column squeezed in-group folded-group run-${run.kind}`}
      style={{ '--group-color': color, '--step-color': color, zIndex } as React.CSSProperties}
      data-testid={`folded-group-${name}`}
    >
      <div className="op-header" onClick={onUnfold} title={`Group ${name}: ${run.text}. Click to unfold`}>
        <div className="arrow-status run-paint" aria-hidden="true" />
        <div className="arrow-background" />
        <div className="group-half last">
          <span className="group-half-name">{name}</span>
          {RUN_ICON[run.kind] && (
            <span className={`group-run-icon run-icon-${run.kind}`}>
              <SymbolIcon name={RUN_ICON[run.kind]!} size={12} />
            </span>
          )}
          {controls}
        </div>
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

import SymbolIcon from './SymbolIcon';
import { RUN_ICON, type RunState } from '../utils/runState';

/** One of a folded group's steps: a parallelogram in its colour. */
export interface FoldedStep { id: string; label: string; color: string; run: RunState }

/**
 * A folded group (dev_plan/141 §3.3): one header the shape of a step's, the
 * group's colour and name on its top half, its steps below as parallelograms,
 * each in its step's colour. Nothing shows under it: folding a group folds
 * its steps' tables with it (a nested expander). A click on the top half
 * opens the group's popover, as the band of an unfolded group does; a click
 * on the steps unfolds it.
 */
export default function FoldedGroup({ name, color, run, steps, zIndex, onOpenGroup, onUnfold }: {
  name: string;
  color: string;
  run: RunState;
  steps: FoldedStep[];
  zIndex: number;
  onOpenGroup: (rect: DOMRect) => void;
  onUnfold: () => void;
}) {
  return (
    <div
      className={`operation-column squeezed folded-group run-${run.kind}`}
      style={{ '--group-color': color, '--step-color': color, zIndex } as React.CSSProperties}
      data-testid={`folded-group-${name}`}
    >
      <div className="op-header">
        <div className="arrow-status run-paint" aria-hidden="true" />
        <div className="arrow-background" />
        <div
          className="folded-top"
          title={`Group ${name}: ${run.text}`}
          onClick={(e) => { e.stopPropagation(); onOpenGroup(e.currentTarget.getBoundingClientRect()); }}
        >
          <span className="group-half-name">{name}</span>
          {RUN_ICON[run.kind] && (
            <span className={`group-run-icon run-icon-${run.kind}`}>
              <SymbolIcon name={RUN_ICON[run.kind]!} size={12} />
            </span>
          )}
        </div>
        <div className="folded-steps" onClick={(e) => { e.stopPropagation(); onUnfold(); }} title={`Unfold ${name}`}>
          {steps.map((s) => (
            <span
              key={s.id}
              className={`folded-step run-${s.run.kind}`}
              style={{ '--fill': s.color } as React.CSSProperties}
              title={`${s.label}: ${s.run.text}`}
              data-testid={`folded-step-${s.id}`}
            >
              <span className="folded-step-label">{s.label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

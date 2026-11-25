import type { ReactNode } from 'react';
import SymbolIcon from './SymbolIcon';
import { RUN_ICON, type RunState } from '../utils/runState';

/**
 * A step group's band (dev_plan/141 §3.2): the top half of its steps'
 * headers, drawn as one piece across them (owner, 2026-11-18: "grouped
 * segments should be connected… not divided by the outline"), shaped as the
 * top half of a step header's arrow, from the first step's tail to the last
 * step's point. Its name, run state, and why its last run didn't run; its
 * controls at its end, shown on hover. A click folds the group.
 */
export default function GroupBand({ name, color, run, error, at, first, controls, onFold }: {
  name: string;
  color: string;
  run: RunState;
  /** Why its last Run group didn't run, short ("run 'load' first"). */
  error?: string;
  at: { left: number; top: number; width: number; height: number };
  /** Over the workflow's first step: no tail notch, as that step's header. */
  first: boolean;
  controls: ReactNode;
  onFold: () => void;
}) {
  return (
    <div
      className={`group-band run-${run.kind}${first ? ' first' : ''}`}
      style={{ left: at.left, top: at.top, width: at.width, height: at.height, '--group-color': color } as React.CSSProperties}
      data-testid={`group-band-${name}`}
      onClick={onFold}
    >
      <div className="group-band-status run-paint" aria-hidden="true" />
      <div className="group-band-fill" aria-hidden="true" />
      <div className="group-band-content" title={`Group ${name}: ${run.text}. Click to fold or unfold`}>
        <span className="group-half-name">{name}</span>
        {RUN_ICON[run.kind] && (
          <span className={`group-run-icon run-icon-${run.kind}`}>
            <SymbolIcon name={RUN_ICON[run.kind]!} size={12} />
          </span>
        )}
        {error && <span className="group-run-error" data-testid="group-run-error">{error}</span>}
      </div>
      {controls}
    </div>
  );
}

import type { SymbolName } from '../components/SymbolIcon';

/**
 * Where a step's run stands, as its header and the steps' map show it
 * (owner, 2026-11-10): the colour of the outline on the step's sides, an
 * icon, a short label, and a sentence for the tooltip.
 *
 * - staged: not run yet (grey)
 * - stale: ran, but something it reads changed since (grey, out of date)
 * - queued: a run will reach it (blue stripes, still)
 * - running: running now (blue stripes, moving toward the next step)
 * - ran: ran cleanly (green)
 * - partial: ran, some rows failed (amber)
 * - failed: the step failed, or every row did (red)
 * - blocked: core can't run it (grey, with the tail outlined red)
 */
export type RunKind = 'staged' | 'stale' | 'queued' | 'running' | 'ran' | 'partial' | 'failed' | 'blocked';
export interface RunState { kind: RunKind; label: string; text: string }

export const RUN_ICON: Record<RunKind, SymbolName> = {
  staged: 'radio_button_unchecked',
  stale: 'update',
  queued: 'hourglass_empty',
  running: 'progress_activity',
  ran: 'check_circle',
  partial: 'warning',
  failed: 'error',
  blocked: 'block',
};

/** A step's run state, from what the app knows of it; *queued* while a run will reach it. */
export function runState(step: {
  status: string; uncaughtFailed?: number; outputRows?: number; staleReason?: string;
  coreState?: string; problems?: string[];
}, queued: boolean): RunState {
  if (step.status === 'running') return { kind: 'running', label: 'running', text: 'running' };
  if (queued) return { kind: 'queued', label: 'queued', text: 'queued: a run will reach it' };
  if (step.status === 'error') {
    return { kind: 'failed', label: 'failed', text: `failed${step.problems?.length ? `: ${step.problems.join('; ')}` : ''}` };
  }
  if (step.coreState === 'invalid' || (step.problems?.length && step.status !== 'completed')) {
    return { kind: 'blocked', label: "can't run", text: `can't run: ${step.problems?.join('; ') || 'invalid'}` };
  }
  if (step.status === 'completed') {
    if (step.staleReason) return { kind: 'stale', label: 'out of date', text: `out of date: ${step.staleReason}. Run it again to update.` };
    const failed = step.uncaughtFailed ?? 0;
    const rows = step.outputRows;
    if (failed && rows !== undefined && failed >= rows) return { kind: 'failed', label: 'failed', text: `every row failed (${failed})` };
    if (failed) return { kind: 'partial', label: 'ran with issues', text: `ran; ${failed}${rows !== undefined ? ` of ${rows}` : ''} rows failed` };
    return { kind: 'ran', label: 'ran', text: rows !== undefined ? `ran: ${rows} row${rows === 1 ? '' : 's'}` : 'ran' };
  }
  return { kind: 'staged', label: 'staged', text: step.status === 'pending' ? 'staged, not run' : step.status };
}

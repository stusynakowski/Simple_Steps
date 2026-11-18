import type { SymbolName } from '../components/SymbolIcon';

/**
 * Where a step's run stands, as its header and the steps' map show it
 * (owner, 2026-11-10): the colour of the outline on the step's sides, an
 * icon, and a sentence for the tooltip.
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
export interface RunState { kind: RunKind; text: string }

/** The icon at a step's tail; a staged step has none (owner, 2026-11-10). */
export const RUN_ICON: Partial<Record<RunKind, SymbolName>> = {
  stale: 'update',
  queued: 'hourglass_empty',
  running: 'progress_activity',
  ran: 'check_circle',
  partial: 'warning',
  failed: 'error',
  blocked: 'block',
};

/** A step group's run state, the group as one step, from core's state for it (dev_plan/141). */
export function groupRunState(group: { state?: string; needsRun?: Record<string, string>; problem?: string; runError?: string }): RunState {
  if (group.problem) return { kind: 'blocked', text: `can't group: ${group.problem}` };
  if (group.runError) return { kind: 'failed', text: `didn't run: ${group.runError}` };
  const waiting = Object.keys(group.needsRun ?? {});
  const needs = waiting.length ? ` (${waiting.join(', ')} need${waiting.length === 1 ? 's' : ''} a run)` : '';
  switch (group.state) {
    case 'completed': return { kind: 'ran', text: 'ran' };
    case 'stale': return { kind: 'stale', text: `out of date${needs}` };
    case 'failed': return { kind: 'failed', text: 'a step failed' };
    case 'invalid': case 'blocked': return { kind: 'blocked', text: `can't run${needs}` };
    default: return { kind: 'staged', text: `not run${needs}` };
  }
}

/** A group run's error, short enough for its band: "run 'load' first", else "didn't run". */
export function groupErrorLabel(error: string): string {
  const reads = error.match(/reads (.+?), which (?:has|have) never run/);
  return reads ? `run ${reads[1]} first` : "didn't run";
}

/** A step's run state, from what the app knows of it; *queued* while a run will reach it. */
export function runState(step: {
  status: string; uncaughtFailed?: number; outputRows?: number; staleReason?: string;
  coreState?: string; problems?: string[];
}, queued: boolean): RunState {
  if (step.status === 'running') return { kind: 'running', text: 'running' };
  if (queued) return { kind: 'queued', text: 'queued: a run will reach it' };
  if (step.status === 'error') {
    return { kind: 'failed', text: `failed${step.problems?.length ? `: ${step.problems.join('; ')}` : ''}` };
  }
  if (step.coreState === 'invalid' || (step.problems?.length && step.status !== 'completed')) {
    return { kind: 'blocked', text: `can't run: ${step.problems?.join('; ') || 'invalid'}` };
  }
  if (step.status === 'completed') {
    if (step.staleReason) return { kind: 'stale', text: `out of date: ${step.staleReason}. Run it again to update.` };
    const failed = step.uncaughtFailed ?? 0;
    const rows = step.outputRows;
    if (failed && rows !== undefined && failed >= rows) return { kind: 'failed', text: `every row failed (${failed})` };
    if (failed) return { kind: 'partial', text: `ran; ${failed}${rows !== undefined ? ` of ${rows}` : ''} rows failed` };
    return { kind: 'ran', text: rows !== undefined ? `ran: ${rows} row${rows === 1 ? '' : 's'}` : 'ran' };
  }
  return { kind: 'staged', text: step.status === 'pending' ? 'staged, not run' : step.status };
}

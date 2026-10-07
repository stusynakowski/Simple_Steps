import type { WorkflowCommand } from '../types/commands';

/**
 * The agent's proposals (docs/dev_plan/122 §3). The backend returns a list of
 * checked changes; the user picks which to apply, and each becomes the same
 * command the console would send, so applying a proposal is replayable and
 * goes through one path.
 */

export type AgentChange =
  | { kind: 'resource'; name: string; definition: string; problem: string | null }
  | { kind: 'add'; name: string; formula: string; after: string | null; problem: string | null }
  | { kind: 'change'; name: string; formula: string; before: string; problem: string | null }
  | { kind: 'remove'; name: string; problem: string | null };

export interface AgentProposal {
  summary: string;
  changes: AgentChange[];
  model: string;
  attempts: number;
}

/** A stable key for one change, for selection state. */
export function changeKey(change: AgentChange): string {
  return `${change.kind}:${change.name}`;
}

/**
 * The commands that apply *selected* changes, in order.
 *
 * A new step goes after its `after` step if that step will exist (it already
 * does, or is being added now); otherwise at the end. A change with a problem
 * is never applied.
 */
export function changesToCommands(
  changes: AgentChange[],
  selected: Set<string>,
  existingSteps: string[],
): WorkflowCommand[] {
  const names = new Set(existingSteps);
  const commands: WorkflowCommand[] = [];
  for (const change of changes) {
    if (change.problem || !selected.has(changeKey(change))) continue;
    switch (change.kind) {
      case 'resource':
        commands.push({ kind: 'define_resource', name: change.name, definition: change.definition });
        break;
      case 'add':
        commands.push({
          kind: 'add',
          name: change.name,
          after: change.after && names.has(change.after) ? change.after : null,
        });
        commands.push({ kind: 'set', target: change.name, formula: change.formula });
        names.add(change.name);
        break;
      case 'change':
        commands.push({ kind: 'set', target: change.name, formula: change.formula });
        break;
      case 'remove':
        commands.push({ kind: 'remove', target: change.name });
        names.delete(change.name);
        break;
    }
  }
  return commands;
}

/**
 * Workflow commands — the canonical form of a user action.
 *
 * `docs/dev_plan/118-console-and-gui-parity.md` sets the rule this file exists
 * to enforce: **every state change has exactly one canonical textual form, and
 * both the GUI and the console produce and consume that form.**
 *
 * A command is *user intent*. It is not every mutation: writing `outputRefId`
 * or `status` back after a run is a *consequence*, keeps using the raw state
 * setter, and must never reach the console — a transcript of consequences
 * cannot be replayed.
 *
 *   GUI click ──► WorkflowCommand ──► dispatch ──► workflow state
 *   console   ──►       ↑ same object, same path
 *
 * Because both directions go through the identical `dispatch`, parity is true
 * by construction rather than by two code paths being kept in step by hand.
 *
 * Steps are addressed positionally (`step1`, `step2`, …) because that is
 * already the vocabulary of the formula bar and of `step_map` on the wire.
 * A position is resolved to a step id *immediately* on dispatch, never stored:
 * positions shift when a step is inserted, and a stored position would
 * silently rewire the graph.
 */

export type WorkflowCommand =
  | { kind: 'set'; target: string; formula: string }
  | { kind: 'add'; name?: string; after?: string | null }
  | { kind: 'remove'; target: string }
  | { kind: 'rename'; target: string; to: string }
  | { kind: 'run'; target: string | null }
  | { kind: 'preview'; target: string }
  // Resources belong to the workflow, not to a step (122 §2.4): the toolbar's
  // Resources menu and the console both produce these.
  | { kind: 'define_resource'; name: string; definition: string }
  | { kind: 'remove_resource'; name: string };

/** Single-quote a string for the canonical form, escaping as Python would. */
function q(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Render a command as the one line that reproduces it.
 *
 * The output is exactly what the console accepts as input — that round trip is
 * the whole point, and `TEST: command round-trip` in `commands.test.ts` holds
 * it to it.
 */
export function formatCommand(cmd: WorkflowCommand): string {
  switch (cmd.kind) {
    case 'set':
      return `wf[${q(cmd.target)}] = ${q(cmd.formula)}`;
    case 'add':
      if (cmd.after) return `wf.add(${cmd.name ? q(cmd.name) + ', ' : ''}after=${q(cmd.after)})`;
      return `wf.add(${cmd.name ? q(cmd.name) : ''})`;
    case 'remove':
      return `wf.remove(${q(cmd.target)})`;
    case 'rename':
      return `wf.rename(${q(cmd.target)}, ${q(cmd.to)})`;
    case 'run':
      return cmd.target ? `wf.run(${q(cmd.target)})` : 'wf.run()';
    case 'preview':
      return `wf.preview(${q(cmd.target)})`;
    case 'define_resource':
      // The definition is code (`Claude(model="…")`), so it is not quoted.
      return `res[${q(cmd.name)}] = ${cmd.definition}`;
    case 'remove_resource':
      return `del res[${q(cmd.name)}]`;
  }
}

/** The commands the console understands, for help text and autocomplete. */
export const COMMAND_HELP: { form: string; what: string }[] = [
  { form: 'wf["step2"] = \'=op(arg=step1["col"])\'', what: "set a step's expression" },
  { form: 'wf.add()', what: 'append a step' },
  { form: 'wf.add("name", after="step1")', what: 'insert a named step' },
  { form: 'wf.remove("step2")', what: 'delete a step' },
  { form: 'wf.rename("step2", "scored")', what: 'rename a step' },
  { form: 'wf.run()', what: 'run the whole pipeline' },
  { form: 'wf.run("step2")', what: 'run one step' },
  { form: 'wf.preview("step2")', what: 'preview one step' },
  { form: 'wf.steps', what: 'list the steps' },
  { form: 'res["llm"] = FakeLLM(model="fake-1")', what: 'create or change a resource' },
  { form: 'del res["llm"]', what: 'delete a resource no step uses' },
  { form: 'step1["score"]', what: 'evaluate an expression against live data' },
];

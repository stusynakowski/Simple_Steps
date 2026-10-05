/**
 * TEST: command round-trip (docs/dev_plan/118-console-and-gui-parity.md CN-07)
 *
 * Parity rests on one property: the canonical text a GUI action emits is
 * exactly the text the console accepts. If `formatCommand` and
 * `parseConsoleLine` ever disagree, the transcript stops being replayable and
 * the console reports a parity that does not exist — the silent-wrong-answer
 * failure mode 118 §9 exists to rule out.
 *
 * So assert the loop directly: command → text → command.
 */

import { describe, it, expect } from 'vitest';
import { formatCommand, type WorkflowCommand } from './commands';
import { parseConsoleLine } from '../utils/consoleParser';

const CASES: WorkflowCommand[] = [
  { kind: 'set', target: 'step2', formula: '=score(url=step1["url"])' },
  { kind: 'set', target: 'step1', formula: '=to_rows(data=[{"a":1}])' },
  // A formula containing quotes of both kinds must survive the trip.
  { kind: 'set', target: 'step3', formula: `=f(x='it\\'s', y="q")` },
  { kind: 'add', name: 'Step 1', after: 'step1' },
  { kind: 'add', after: null },
  { kind: 'remove', target: 'step2' },
  { kind: 'rename', target: 'step2', to: 'scored' },
  { kind: 'run', target: 'step2' },
  { kind: 'run', target: null },
  { kind: 'preview', target: 'step2' },
];

describe('command round-trip', () => {
  it.each(CASES)('survives format → parse: %o', (cmd) => {
    const text = formatCommand(cmd);
    const parsed = parseConsoleLine(text);
    expect(parsed.kind, `could not parse ${text}`).toBe('command');
    if (parsed.kind !== 'command') return;

    // `add` normalises an absent name to undefined and absent after to null,
    // so compare on the normalised shape rather than raw object identity.
    const norm = (c: WorkflowCommand) =>
      c.kind === 'add' ? { kind: 'add', name: c.name ?? undefined, after: c.after ?? null } : c;

    expect(norm(parsed.command)).toEqual(norm(cmd));
  });
});

describe('console parser', () => {
  it('treats a non-wf line as an expression for the backend', () => {
    const p = parseConsoleLine('step1["score"][1]');
    expect(p).toEqual({ kind: 'expression', source: 'step1["score"][1]' });
  });

  it('accepts a bare (unquoted) formula on the right-hand side', () => {
    // Typing the outer quotes by hand is a nuisance; the canonical emitted
    // form keeps them, but input must tolerate either.
    const p = parseConsoleLine('wf["step2"] = =score(a=1)');
    expect(p).toEqual({
      kind: 'command',
      command: { kind: 'set', target: 'step2', formula: '=score(a=1)' },
    });
  });

  it('rejects an unknown wf method rather than guessing', () => {
    const p = parseConsoleLine('wf.destroy("step2")');
    expect(p.kind).toBe('error');
  });

  it('does not mistake a comma inside a formula for an argument separator', () => {
    const p = parseConsoleLine('wf.rename("step2", "a, b")');
    expect(p).toEqual({
      kind: 'command',
      command: { kind: 'rename', target: 'step2', to: 'a, b' },
    });
  });
});

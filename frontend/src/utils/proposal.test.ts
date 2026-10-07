/**
 * TEST: an agent proposal becomes console commands (docs/dev_plan/122 §3).
 * Only selected, valid changes apply, in order; a new step goes after its
 * anchor only if that step will exist.
 */
import { describe, expect, it } from 'vitest';
import { changeKey, changesToCommands, type AgentChange } from './proposal';

const changes: AgentChange[] = [
  { kind: 'resource', name: 'house_llm', definition: "FakeLLM(model='house-1')", problem: null },
  { kind: 'add', name: 'scored', formula: '=scale[mod.map()](wf["readings"])', after: 'readings', problem: null },
  { kind: 'add', name: 'summaries', formula: '=summarize[mod.map()](wf["notes"], llm=res["house_llm"])',
    after: 'scored', problem: null },
  { kind: 'change', name: 'notes', formula: '=to_rows[mod.source()](data=\'{}\')', before: '=old', problem: null },
  { kind: 'add', name: 'broken', formula: '=nope(wf["x"])', after: 'summaries', problem: 'there\'s no tool named nope' },
  { kind: 'remove', name: 'old', problem: null },
];
const all = new Set(changes.map(changeKey));

describe('changesToCommands', () => {
  it('turns every valid change into commands, in order', () => {
    expect(changesToCommands(changes, all, ['readings', 'notes', 'old'])).toEqual([
      { kind: 'define_resource', name: 'house_llm', definition: "FakeLLM(model='house-1')" },
      { kind: 'add', name: 'scored', after: 'readings' },
      { kind: 'set', target: 'scored', formula: '=scale[mod.map()](wf["readings"])' },
      { kind: 'add', name: 'summaries', after: 'scored' },
      { kind: 'set', target: 'summaries', formula: '=summarize[mod.map()](wf["notes"], llm=res["house_llm"])' },
      { kind: 'set', target: 'notes', formula: '=to_rows[mod.source()](data=\'{}\')' },
      { kind: 'remove', target: 'old' },
    ]);
  });

  it('never applies a change that failed its checks, even if selected', () => {
    const cmds = changesToCommands(changes, all, ['readings', 'notes', 'old']);
    expect(cmds.some((c) => 'target' in c && c.target === 'broken')).toBe(false);
  });

  it('puts a new step at the end when its anchor was not applied', () => {
    const selected = new Set([changeKey(changes[2])]);           // summaries, but not scored
    expect(changesToCommands(changes, selected, ['readings'])[0]).toEqual(
      { kind: 'add', name: 'summaries', after: null },
    );
  });
});

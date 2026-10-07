/**
 * TEST: resource helpers (docs/dev_plan/122 §2.4) — the Resources menu shows a
 * declaration as the formula that creates it, and refuses to delete one a
 * step still uses.
 */
import { describe, expect, it } from 'vitest';
import type { Step } from '../types/models';
import { definitionText, pyLiteral, stepsUsingResource } from './resources';

const step = (label: string, formula: string) => ({ id: label, label, formula } as unknown as Step);

describe('definitionText', () => {
  it('writes a declaration as Type(setting=literal)', () => {
    expect(definitionText({ source: 'defined', type: 'FakeLLM', settings: { model: 'fake-1' } }))
      .toBe('FakeLLM(model="fake-1")');
    expect(definitionText({ source: 'defined', type: 'FakeDB' })).toBe('FakeDB()');
  });

  it('writes literals the way Python reads them', () => {
    expect(pyLiteral({ SF: 'west', n: [1, true, null] })).toBe('{"SF": "west", "n": [1, True, None]}');
  });
});

describe('stepsUsingResource', () => {
  const steps = [
    step('regions', '=enrich[mod.map()](wf["readings"], db=res["db"])'),
    step('bound', "=res['db'].lookup[mod.map()](wf['keys'])"),
    step('other', '=summarize[mod.map()](wf["notes"], res["llm"])'),
    step('lookalike', '=f(wf["db"])'),
  ];

  it('finds every step that names the resource, in either quote style', () => {
    expect(stepsUsingResource(steps, 'db')).toEqual(['regions', 'bound']);
  });

  it('ignores a step that only has a same-named step reference', () => {
    expect(stepsUsingResource(steps, 'llm')).toEqual(['other']);
  });
});

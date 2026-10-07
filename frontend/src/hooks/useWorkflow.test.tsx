/**
 * TEST: commands applied back to back (an agent proposal, a pasted console
 * script) see each other's effects. `add` keeps its name and `set` can address
 * that step at once — before, the step lookup read state from the last render.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  getOperations: vi.fn(async () => []),
}));
vi.mock('../utils/formulaParser', () => ({
  parseFormula: vi.fn(async () => ({ isValid: false, operationId: null, args: {} })),
  buildFormula: vi.fn(async () => ''),
}));

import useWorkflow from './useWorkflow';

describe('useWorkflow: commands in a row', () => {
  it('adds a named step and sets its formula in the same tick', async () => {
    const { result } = renderHook(() => useWorkflow());
    const before = result.current.workflow.steps.length;
    await act(async () => {
      await result.current.dispatchCommand({ kind: 'add', name: 'scored', after: null }, 'agent');
      await result.current.dispatchCommand({ kind: 'set', target: 'scored', formula: '=scale(wf["r"])' }, 'agent');
    });
    const steps = result.current.workflow.steps;
    expect(steps).toHaveLength(before + 1);
    expect(steps[steps.length - 1].label).toBe('scored');
    expect(steps[steps.length - 1].formula).toBe('=scale(wf["r"])');
  });

  it('removes a step the same tick it was added', async () => {
    const { result } = renderHook(() => useWorkflow());
    const before = result.current.workflow.steps.length;
    await act(async () => {
      await result.current.dispatchCommand({ kind: 'add', name: 'tmp', after: null });
      await result.current.dispatchCommand({ kind: 'remove', target: 'tmp' });
    });
    expect(result.current.workflow.steps).toHaveLength(before);
  });
});

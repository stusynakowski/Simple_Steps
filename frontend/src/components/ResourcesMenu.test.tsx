/**
 * TEST: the toolbar's Resources menu (docs/dev_plan/122 §2.4). Resources are
 * created and changed here, never in a step; a resource a step uses can't be
 * deleted; a resource whose type the app lacks is flagged.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Step } from '../types/models';
import ResourcesMenu from './ResourcesMenu';

vi.mock('../services/api', () => ({
  fetchResourceTypes: vi.fn(async () => ({
    FakeLLM: {
      type: 'FakeLLM', description: 'a dummy model',
      settings: [{ name: 'model', type: 'str', required: false, default: 'fake-1' }],
      tools: { 'FakeLLM.complete': {} },
    },
    FakeDB: { type: 'FakeDB', settings: [], tools: { 'FakeDB.lookup': {} } },
  })),
}));

const steps = [
  { id: 'a', label: 'summaries', formula: '=summarize[mod.map()](wf["notes"], llm=res["llm"])' },
] as unknown as Step[];

const resources = {
  llm: { source: 'defined', type: 'FakeLLM', settings: { model: 'fake-1' } },
  db: { source: 'defined', type: 'FakeDB' },
};

describe('ResourcesMenu', () => {
  let onDefine: ReturnType<typeof vi.fn>;
  let onRemove: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onDefine = vi.fn(async () => {});
    onRemove = vi.fn();
  });

  const open = () => {
    render(<ResourcesMenu resources={resources} steps={steps} onDefine={onDefine} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: /Resources/ }));
  };

  it('lists each resource as the formula that creates it, with who uses it', () => {
    open();
    expect(screen.getByText('FakeLLM(model="fake-1")')).toBeInTheDocument();
    expect(screen.getByText('used by summaries')).toBeInTheDocument();
    expect(screen.getByText('not used yet')).toBeInTheDocument();
  });

  it('adds a resource from a name and a Type(…) definition', async () => {
    open();
    fireEvent.click(screen.getByText('+ New resource'));
    fireEvent.change(screen.getByPlaceholderText(/name, e.g./), { target: { value: 'llm2' } });
    await waitFor(() => screen.getByText('FakeLLM', { selector: 'button' }));
    fireEvent.click(screen.getByText('FakeLLM', { selector: 'button' }));   // fills the template
    expect(screen.getByDisplayValue('FakeLLM(model="fake-1")')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(onDefine).toHaveBeenCalledWith('llm2', 'FakeLLM(model="fake-1")'));
  });

  it('shows why a delete was refused', () => {
    onRemove.mockImplementation(() => { throw new Error('res["llm"] is used by summaries. Change those steps first.'); });
    open();
    fireEvent.click(screen.getAllByTitle(/Used by summaries/)[0]);
    expect(screen.getByText(/is used by summaries/)).toBeInTheDocument();
  });

  it('flags a resource whose type this app does not have', async () => {
    render(
      <ResourcesMenu
        resources={{ ghost: { source: 'defined', type: 'Gone' } }}
        steps={[]} onDefine={onDefine} onRemove={onRemove}
      />,
    );
    await waitFor(() => expect(screen.getByTitle('A resource needs attention')).toBeInTheDocument());
  });
});

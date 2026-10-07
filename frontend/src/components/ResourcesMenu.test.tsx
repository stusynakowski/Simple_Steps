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
  fetchLoadedResources: vi.fn(async () => ({
    house_llm: { type: 'FakeLLM', settings: { model: 'house-1' }, from_env: {}, locked: [] },
    vault: { type: 'FakeLLM', settings: { model: 'v-1' }, from_env: { api_key: 'env:VAULT_KEY' }, locked: ['api_key'] },
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

  it('offers the deployment\'s ready-made resources and adds one with Use', async () => {
    open();
    await waitFor(() => screen.getByText('From the deployment'));
    fireEvent.click(screen.getAllByText('Use')[0]);
    await waitFor(() => expect(onDefine).toHaveBeenCalledWith('house_llm', 'FakeLLM(model="house-1")'));
  });

  it('shows a ready-made resource with its changes, and flags a deployment change', async () => {
    render(
      <ResourcesMenu
        resources={{
          house_llm: { source: 'loaded', type: 'FakeLLM', as_loaded: { model: 'house-0' },
                       overrides: { temperature: 0.7 } },
        }}
        steps={[]} onDefine={onDefine} onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Resources/ }));
    await waitFor(() => screen.getByText('ready-made'));
    expect(screen.getByText('FakeLLM(model="house-1", temperature=0.7)')).toBeInTheDocument();
    expect(screen.getByText('changed: temperature=0.7')).toBeInTheDocument();
    expect(screen.getByText(/changed since saved \(model: "house-0" → "house-1"\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Accept'));
    await waitFor(() => expect(onDefine).toHaveBeenCalledWith('house_llm', 'FakeLLM(model="house-1", temperature=0.7)'));
  });

  it('flags a ready-made resource the deployment does not provide here', async () => {
    render(
      <ResourcesMenu
        resources={{ gone: { source: 'loaded', type: 'FakeLLM', as_loaded: { model: 'x' } } }}
        steps={[]} onDefine={onDefine} onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Resources/ }));
    await waitFor(() => screen.getByText("The deployment doesn't provide it here."));
    expect(screen.getByTitle('A resource needs attention')).toBeInTheDocument();
  });
});

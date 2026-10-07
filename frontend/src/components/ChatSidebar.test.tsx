/**
 * TEST: the agent panel (docs/dev_plan/122 §3). The agent proposes, the user
 * disposes: valid changes start selected, a change that failed its checks is
 * shown with its reason and can't be picked, and Apply sends the commands.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ChatSidebar, { ProposalCard } from './ChatSidebar';
import type { AgentProposal } from '../utils/proposal';

const proposal: AgentProposal = {
  summary: 'Score the readings.',
  model: 'llama3.2:3b',
  attempts: 2,
  changes: [
    { kind: 'add', name: 'scored', formula: '=scale[mod.map()](wf["readings"])', after: 'readings', problem: null },
    { kind: 'add', name: 'broken', formula: '=nope(wf["x"])', after: 'scored', problem: "there's no tool named nope" },
  ],
};

vi.mock('../services/agentApi', () => ({
  getAgentStatus: vi.fn(async () => ({ available: true, model: 'llama3.2:3b', provider: 'ollama' })),
  proposeChanges: vi.fn(async () => proposal),
  getAgentConfig: vi.fn(async () => ({})),
  updateAgentConfig: vi.fn(async () => ({})),
  getAgentHealth: vi.fn(async () => ({ ready: true })),
}));

describe('ProposalCard', () => {
  it('pre-selects valid changes and disables invalid ones, with the reason', () => {
    render(<ProposalCard proposal={proposal} existingSteps={['readings']} onApply={vi.fn()} />);
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(false);
    expect(boxes[1].disabled).toBe(true);
    expect(screen.getByText("there's no tool named nope")).toBeInTheDocument();
    expect(screen.getByText('corrected 1×')).toBeInTheDocument();
  });

  it('applies the selected changes as console commands', async () => {
    const onApply = vi.fn(async () => {});
    render(<ProposalCard proposal={proposal} existingSteps={['readings']} onApply={onApply} />);
    fireEvent.click(screen.getByText('Apply 1 change'));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith([
      { kind: 'add', name: 'scored', after: 'readings' },
      { kind: 'set', target: 'scored', formula: '=scale[mod.map()](wf["readings"])' },
    ]));
  });
});

describe('ChatSidebar', () => {
  it('sends a request and shows the proposal; Apply reaches the workflow', async () => {
    const onApplyCommands = vi.fn(async () => {});
    render(
      <ChatSidebar
        isVisible
        workflow={{ id: 'w', name: 'w', created_at: '', steps: [] }}
        onApplyCommands={onApplyCommands}
      />,
    );
    await waitFor(() => expect(screen.getByText('🤖 llama3.2:3b')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Describe what you want/), { target: { value: 'score it' } });
    fireEvent.keyDown(screen.getByPlaceholderText(/Describe what you want/), { key: 'Enter' });
    expect(await screen.findByText('Score the readings.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Apply 1 change'));
    await waitFor(() => expect(onApplyCommands).toHaveBeenCalled());
    expect(await screen.findByText(/Applied 2 commands/)).toBeInTheDocument();
  });
});

import { render, screen, within } from '@testing-library/react';
import UnifiedToolbar from './UnifiedToolbar';
import { describe, it, expect, vi } from 'vitest';
import type { Connection } from '../hooks/useConnection';

// No workflow-toolbar REQ id exists in docs/spec yet; add one there and cite it here.

const connection = { status: 'connected', apiBase: '', retry: vi.fn() } as unknown as Connection;

const renderToolbar = () => render(
  <UnifiedToolbar
    onRunAll={vi.fn()}
    onPauseAll={vi.fn()}
    onStopAll={vi.fn()}
    pipelineStatus="idle"
    onToggleLogs={vi.fn()}
    connection={connection}
    overviewMenu={<button>Overview</button>}
    workflowSlot={<span>wf-extra</span>}
    infoSlot={<span>info-extra</span>}
  />,
);

describe('UnifiedToolbar', () => {
  it('puts the workflow on the top row: Overview, slot, server status', () => {
    renderToolbar();
    const row = screen.getByTestId('ut-row-workflow');
    expect(within(row).getByText('Overview')).toBeInTheDocument();
    expect(within(row).getByTestId('ut-workflow-slot')).toHaveTextContent('wf-extra');
    expect(within(row).queryByTitle('Run Pipeline')).toBeNull();
  });

  it('puts running it on the bottom row: run controls, status, slot, logs', () => {
    renderToolbar();
    const row = screen.getByTestId('ut-row-run');
    expect(within(row).getByTitle('Run Pipeline')).toBeInTheDocument();
    expect(within(row).getByTitle('Stop Pipeline')).toBeDisabled();
    expect(within(row).getByTestId('ut-run-status')).toHaveTextContent('Idle');
    expect(within(row).getByTestId('ut-info-slot')).toHaveTextContent('info-extra');
    expect(within(row).getByTitle('Open Logs')).toBeInTheDocument();
  });
});

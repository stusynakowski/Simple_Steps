import { render, screen, fireEvent } from '@testing-library/react';
import StepToolbar from './StepToolbar';
import { describe, it, expect, vi } from 'vitest';
import type { Step } from '../types/models';
import { StepWiringProvider } from '../context/StepWiringContext';

const sampleStep: Step = {
  id: 's-1',
  sequence_index: 0,
  label: 'Sample Step',
  formula: '',
  process_type: 'noop',
  configuration: {},
  status: 'completed',
};

describe('StepToolbar', () => {
  it('renders buttons and calls handlers', () => {
    const onRun = vi.fn();

    render(
      <StepWiringProvider>
        <StepToolbar step={sampleStep} onRun={onRun}
          openPanels={[]} onTogglePanel={() => {}} />
      </StepWiringProvider>
    );

    expect(screen.getByTestId('step-toolbar')).toBeInTheDocument();
    const runBtn = screen.getByTestId('btn-run');

    fireEvent.click(runBtn);
    expect(onRun).toHaveBeenCalledWith('s-1');
    // Delete moved to the step header's ⋯ menu (owner, 2026-11-24).
  });
});

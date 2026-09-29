import { render, screen, fireEvent } from '@testing-library/react';
import StepIcon from './StepIcon';
import { describe, it, expect, vi } from 'vitest';

const sampleStep = {
  id: 'test-step-1',
  sequence_index: 0,
  label: 'Test Step',
  formula: '',
  process_type: 'noop',
  configuration: {},
  status: 'completed' as const,
};

describe('StepIcon', () => {
  it('renders label and status class', () => {
    render(<StepIcon step={sampleStep} />);
    const el = screen.getByTestId('step-icon-test-step-1');
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass('status-completed');
    expect(screen.getByText('Test Step')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<StepIcon step={sampleStep} onClick={onClick} />);
    fireEvent.click(screen.getByTestId('step-icon-test-step-1'));
    expect(onClick).toHaveBeenCalledWith('test-step-1');
  });

  it('shows restore control only when maximized', () => {
    const onMaximize = vi.fn();
    const { rerender } = render(<StepIcon step={sampleStep} onMaximize={onMaximize} />);
    expect(screen.queryByRole('button', { name: 'Restore Test Step' })).not.toBeInTheDocument();

    rerender(<StepIcon step={sampleStep} isMaximized onMaximize={onMaximize} />);
    const restore = screen.getByRole('button', { name: 'Restore Test Step' });
    fireEvent.click(restore);
    expect(onMaximize).toHaveBeenCalledWith('test-step-1');
  });
});

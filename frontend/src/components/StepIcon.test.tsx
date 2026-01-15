import { render, screen, fireEvent } from '@testing-library/react';
import StepIcon from './StepIcon';
import { describe, it, expect, vi } from 'vitest';

const sampleStep = {
  id: 'test-step-1',
  sequence_index: 0,
  label: 'Test Step',
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
});

import { render, screen, fireEvent } from '@testing-library/react';
import StepToolbar from './StepToolbar';
import { describe, it, expect, vi } from 'vitest';
import type { Step } from '../types/models';

const sampleStep: Step = {
  id: 's-1',
  sequence_index: 0,
  label: 'Sample Step',
  process_type: 'noop',
  configuration: {},
  status: 'completed',
};

describe('StepToolbar', () => {
  it('renders buttons and calls handlers', () => {
    const onRun = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(<StepToolbar step={sampleStep} onRun={onRun} onEdit={onEdit} onDelete={onDelete} />);

    expect(screen.getByTestId('step-toolbar')).toBeInTheDocument();
    const runBtn = screen.getByTestId('btn-run');
    const editBtn = screen.getByTestId('btn-edit');
    const delBtn = screen.getByTestId('btn-delete');

    fireEvent.click(runBtn);
    expect(onRun).toHaveBeenCalledWith('s-1');

    fireEvent.click(editBtn);
    expect(onEdit).toHaveBeenCalledWith('s-1');

    fireEvent.click(delBtn);
    expect(onDelete).toHaveBeenCalledWith('s-1');
  });
});

import { render, screen, fireEvent } from '@testing-library/react';
import StepDetailView from './StepDetailView';
import { describe, it, expect, vi } from 'vitest';
import type { Step, Cell } from '../types/models';
import { StepWiringProvider } from '../context/StepWiringContext';

const previewCells: Cell[] = [
  { row_id: 0, column_id: 'name', value: 'Alice', display_value: 'Alice' },
  { row_id: 0, column_id: 'age', value: 30, display_value: '30' },
  { row_id: 1, column_id: 'name', value: 'Bob', display_value: 'Bob' },
  { row_id: 1, column_id: 'age', value: 25, display_value: '25' },
];

const sampleStep: Step = {
  id: 's-1',
  sequence_index: 0,
  label: 'Sample Step',
  formula: '',
  process_type: 'noop',
  configuration: {},
  status: 'completed',
  output_preview: previewCells,
};

describe('StepDetailView', () => {
  it('shows empty state when no step', () => {
    render(<StepDetailView step={null} />);
    expect(screen.getByTestId('step-detail-empty')).toBeInTheDocument();
  });

  it('renders toolbar and calls callbacks', () => {
    const onRun = vi.fn();
    const onDelete = vi.fn();

    render(
      <StepWiringProvider>
        <StepDetailView step={sampleStep} onRun={onRun} onDelete={onDelete} />
      </StepWiringProvider>
    );

    expect(screen.getByTestId('step-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('btn-run')).toBeInTheDocument();

    // run and delete buttons call handlers
    fireEvent.click(screen.getByTestId('btn-run'));
    expect(onRun).toHaveBeenCalledWith('s-1');

    fireEvent.click(screen.getByTestId('btn-delete'));
    expect(onDelete).toHaveBeenCalledWith('s-1');
  });
});

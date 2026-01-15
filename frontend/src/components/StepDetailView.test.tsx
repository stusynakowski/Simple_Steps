import { render, screen, fireEvent } from '@testing-library/react';
import StepDetailView from './StepDetailView';
import { describe, it, expect, vi } from 'vitest';
import { mockCells } from '../mocks/initialData';
import type { Step } from '../types/models';

const sampleStep: Step = {
  id: 's-1',
  sequence_index: 0,
  label: 'Sample Step',
  process_type: 'noop',
  configuration: {},
  status: 'completed',
  output_preview: mockCells,
};

describe('StepDetailView', () => {
  it('shows empty state when no step', () => {
    render(<StepDetailView step={null} />);
    expect(screen.getByTestId('step-detail-empty')).toBeInTheDocument();
  });

  it('renders toolbar and output grid and calls callbacks', () => {
    const onRun = vi.fn();
    const onDelete = vi.fn();
    const onCellClick = vi.fn();

    render(
      <StepDetailView step={sampleStep} onRun={onRun} onDelete={onDelete} onCellClick={onCellClick} />
    );

    expect(screen.getByTestId('step-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('btn-run')).toBeInTheDocument();

    // output grid should render cells from mockCells
    expect(screen.getByTestId('output-grid')).toBeInTheDocument();

    // pick a cell and click it
    const cell = screen.getByTestId('cell-0-name');
    expect(cell).toHaveTextContent('Alice');
    fireEvent.click(cell);
    expect(onCellClick).toHaveBeenCalled();

    // run and delete buttons call handlers
    fireEvent.click(screen.getByTestId('btn-run'));
    expect(onRun).toHaveBeenCalledWith('s-1');

    fireEvent.click(screen.getByTestId('btn-delete'));
    expect(onDelete).toHaveBeenCalledWith('s-1');
  });
});

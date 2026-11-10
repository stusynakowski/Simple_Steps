import { render, screen, fireEvent } from '@testing-library/react';
import DataOutputGrid from './DataOutputGrid';
import { describe, it, expect, vi } from 'vitest';
import type { Cell } from '../types/models';

const mockCells: Cell[] = [
  { row_id: 0, column_id: 'name', value: 'Alice', display_value: 'Alice' },
  { row_id: 0, column_id: 'age', value: 30, display_value: '30' },
  { row_id: 1, column_id: 'name', value: 'Bob', display_value: 'Bob' },
  { row_id: 1, column_id: 'age', value: 25, display_value: '25' },
];

describe('DataOutputGrid', () => {
  it('renders grid and calls onCellClick', () => {
    const onCellClick = vi.fn();
    render(<DataOutputGrid cells={mockCells} onCellClick={onCellClick} />);

    // The component renders a role="grid" element
    const grid = screen.getByRole('grid');
    expect(grid).toBeInTheDocument();

    // Check that column headers appear
    expect(screen.getByRole('columnheader', { name: 'name' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'age' })).toBeInTheDocument();

    // Check that cell values appear and are clickable
    const aliceCell = screen.getByText('Alice');
    expect(aliceCell).toBeInTheDocument();
    fireEvent.click(aliceCell);
    expect(onCellClick).toHaveBeenCalled();
  });

  it('shows a step with no output as a 1×1 dataframe whose cell says empty', () => {
    // Data is always a dataframe: an empty or undefined expression still has one,
    // its column named after the step, as core names it (core 1.0.2, FT2).
    for (const cells of [[], undefined]) {
      const { unmount } = render(<DataOutputGrid cells={cells} stepName="totals" />);
      expect(screen.getByRole('grid')).toBeInTheDocument();
      expect(screen.getAllByRole('columnheader')).toHaveLength(1);
      expect(screen.getByRole('columnheader', { name: 'totals' })).toBeInTheDocument();
      expect(screen.getAllByRole('row')).toHaveLength(1);
      const cell = screen.getByRole('gridcell');
      expect(cell).toHaveTextContent('empty');
      expect(cell).toHaveClass('empty-frame-cell');
      unmount();
    }
  });
});

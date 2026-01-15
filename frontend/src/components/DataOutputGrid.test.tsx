import { render, screen, fireEvent } from '@testing-library/react';
import DataOutputGrid from './DataOutputGrid';
import { describe, it, expect, vi } from 'vitest';
import { mockCells } from '../mocks/initialData';

describe('DataOutputGrid', () => {
  it('renders grid and calls onCellClick', () => {
    const onCellClick = vi.fn();
    render(<DataOutputGrid cells={mockCells} onCellClick={onCellClick} />);

    expect(screen.getByTestId('output-grid')).toBeInTheDocument();

    const cell = screen.getByTestId('cell-0-name');
    expect(cell).toHaveTextContent('Alice');

    fireEvent.click(cell);
    expect(onCellClick).toHaveBeenCalled();
  });

  it('renders no outputs when empty', () => {
    render(<DataOutputGrid cells={[]} />);
    expect(screen.getByTestId('no-outputs')).toBeInTheDocument();
  });
});

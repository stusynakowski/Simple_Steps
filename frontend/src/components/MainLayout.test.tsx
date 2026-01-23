import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import MainLayout from './MainLayout';
import { describe, it, expect } from 'vitest';

describe('MainLayout', () => {
  it('renders header and dynamic columns', () => {
    render(<MainLayout />);
    expect(screen.getByTestId('main-layout')).toBeInTheDocument();
    
    // Check for the new columns container
    expect(screen.getByTestId('columns-container')).toBeInTheDocument();

    // Check for the first column exists instead of workflow sequence
    // The test ID is constructed inside OperationColumn: `operation-column-${step.id}`
    const first = screen.getByTestId('operation-column-step-001');
    expect(first).toBeInTheDocument();

    // The first step should be active by default
    expect(first).toHaveClass('active');

    // Clicking it should toggle it (deactivate since it was active)
    fireEvent.click(first);
    expect(first).not.toHaveClass('active');
    expect(first).toHaveClass('squeezed');

    // Clicking again should reactivate it
    fireEvent.click(first);
    expect(first).toHaveClass('active');
  });

  it('can run a pending step from the column toolbar', async () => {
    render(<MainLayout />);

    const third = screen.getByTestId('operation-column-step-003');
    expect(third).toBeInTheDocument();

    // Activate the column to make toolbar visible (though button might be in DOM anyway, CSS hides it)
    fireEvent.click(third);
    
    // Find the run button. Since we use title="Run" in the newcomponent
    // Scope search to the active column to avoid finding buttons in other columns
    const runBtn = within(third).getByTitle('Run');
    fireEvent.click(runBtn);

    // Status is shown in the column header area as text
    // "running" status class should appear
    await waitFor(() => {
        expect(third).toHaveClass('status-running');
    });

    // Wait for completion
    await waitFor(() => {
        expect(third).toHaveClass('status-completed');
    }, { timeout: 2000 });
  });
});

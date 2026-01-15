import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MainLayout from './MainLayout';
import { describe, it, expect } from 'vitest';

describe('MainLayout', () => {
  it('renders header and workflow components and supports step selection', () => {
    render(<MainLayout />);
    expect(screen.getByTestId('main-layout')).toBeInTheDocument();
    expect(screen.getByTestId('workflow-area')).toBeInTheDocument();
    expect(screen.getByTestId('step-detail')).toBeInTheDocument();

    // WorkflowSequence should exist and contain step icons from mock data
    const sequence = screen.getByTestId('workflow-sequence');
    expect(sequence).toBeInTheDocument();

    const first = screen.getByTestId('step-icon-step-001');
    expect(first).toBeInTheDocument();

    // selecting the first step should show its details
    fireEvent.click(first);
    expect(screen.getByTestId('step-detail-content')).toHaveTextContent('Load Data');

    // toolbar should be present in the detail view
    expect(screen.getByTestId('step-toolbar')).toBeInTheDocument();
  });

  it('can run a pending step and updates UI accordingly', async () => {
    // use real timers here to let the mock API resolve naturally
    render(<MainLayout />);

    const third = screen.getByTestId('step-icon-step-003');
    expect(third).toBeInTheDocument();

    // select and run
    fireEvent.click(third);
    expect(screen.getByTestId('step-detail-content')).toHaveTextContent('Export Report');

    fireEvent.click(screen.getByTestId('btn-run'));

    // status should update immediately to running
    expect(screen.getByTestId('step-detail-content')).toHaveTextContent('Status: running');
    expect(screen.getByTestId('step-icon-step-003')).toHaveClass('status-running');

    // wait for the mock API to resolve and update the UI to completed
    await waitFor(() => expect(screen.getByTestId('step-detail-content')).toHaveTextContent('Status: completed'), { timeout: 2000 });

    // output grid should be present after completion
    expect(screen.getByTestId('output-grid')).toBeInTheDocument();
  });
});

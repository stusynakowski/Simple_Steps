import { render, screen, fireEvent } from '@testing-library/react';
import WorkflowSequence from './WorkflowSequence';
import { describe, it, expect, vi } from 'vitest';
import { initialWorkflow } from '../mocks/initialData';

describe('WorkflowSequence', () => {
  it('renders sequence and handles interactions', () => {
    const onSelect = vi.fn();
    const onAdd = vi.fn();

    render(
      <WorkflowSequence
        steps={initialWorkflow.steps}
        selectedStepId={null}
        onSelect={onSelect}
        onAdd={onAdd}
      />
    );

    const sequence = screen.getByTestId('workflow-sequence');
    expect(sequence).toBeInTheDocument();

    // step icon exists
    const first = screen.getByTestId('step-icon-step-001');
    expect(first).toBeInTheDocument();

    // click step
    fireEvent.click(first);
    expect(onSelect).toHaveBeenCalledWith('step-001');

    // add buttons exist
    const addBtn = screen.getByTestId('btn-add-1');
    expect(addBtn).toBeInTheDocument();

    fireEvent.click(addBtn);
    expect(onAdd).toHaveBeenCalledWith(1);

    const addEnd = screen.getByTestId('btn-add-end');
    fireEvent.click(addEnd);
    expect(onAdd).toHaveBeenCalledWith(initialWorkflow.steps.length);
  });
});

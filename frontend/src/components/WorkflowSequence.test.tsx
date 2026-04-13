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

    // The initial workflow now has a single step with id 'step-000'
    const first = screen.getByTestId('step-icon-step-000');
    expect(first).toBeInTheDocument();

    // click step
    fireEvent.click(first);
    expect(onSelect).toHaveBeenCalledWith('step-000');

    // add-end button exists (no btn-add-1 when there's only 1 step and index > 0 add buttons are between steps)
    const addEnd = screen.getByTestId('btn-add-end');
    fireEvent.click(addEnd);
    expect(onAdd).toHaveBeenCalledWith(initialWorkflow.steps.length);
  });
});

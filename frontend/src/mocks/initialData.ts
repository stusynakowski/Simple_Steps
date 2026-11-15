import type { Workflow, Step } from '../types/models';

// Mock pipelines used in tests and demos. Formulas are inlined as strings
// rather than built via `buildFormula(...)` so this module stays synchronous
// (buildFormula is now an async backend call).

const step0: Step = {
  id: 'step-000',
  sequence_index: 0,
  label: 'Step 1',          // counted from 1, as the steps' map is
  formula: '',
  process_type: 'noop',
  configuration: {},
  status: 'pending',
  output_preview: [],
};

export const initialWorkflow: Workflow = {
  id: 'wf-initial',
  name: 'New Workflow',
  created_at: new Date().toISOString(),
  steps: [step0],
};

export const mockCells = [
  { row_id: 1, column_id: 'A', value: 10, display_value: '10' },
  { row_id: 1, column_id: 'B', value: 'foo', display_value: 'foo' },
  { row_id: 2, column_id: 'A', value: 20, display_value: '20' },
  { row_id: 2, column_id: 'B', value: 'bar', display_value: 'bar' },
];


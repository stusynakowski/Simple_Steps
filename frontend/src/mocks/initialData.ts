import type { Workflow, Step, Cell } from '../types/models';

export const mockCells: Cell[] = [
  { row_id: 0, column_id: 'name', value: 'Alice', display_value: 'Alice' },
  { row_id: 0, column_id: 'age', value: 30, display_value: '30' },
  { row_id: 1, column_id: 'name', value: 'Bob', display_value: 'Bob' },
  { row_id: 1, column_id: 'age', value: 25, display_value: '25' },
  { row_id: 2, column_id: 'name', value: 'Charlie', display_value: 'Charlie' },
  { row_id: 2, column_id: 'age', value: 35, display_value: '35' },
];

const step1: Step = {
  id: 'step-001',
  sequence_index: 0,
  label: 'Load Data',
  process_type: 'load_csv',
  configuration: {
    source: 'users.csv',
  },
  status: 'completed',
  output_preview: mockCells,
};

const step2: Step = {
  id: 'step-002',
  sequence_index: 1,
  label: 'Filter Data',
  process_type: 'filter_rows',
  configuration: {
    column: 'age',
    operator: '>',
    value: 28,
  },
  status: 'completed',
  output_preview: [
    { row_id: 0, column_id: 'name', value: 'Alice', display_value: 'Alice' },
    { row_id: 0, column_id: 'age', value: 30, display_value: '30' },
    { row_id: 2, column_id: 'name', value: 'Charlie', display_value: 'Charlie' },
    { row_id: 2, column_id: 'age', value: 35, display_value: '35' },
  ],
};

const step3: Step = {
  id: 'step-003',
  sequence_index: 2,
  label: 'Export Report',
  process_type: 'export_pdf',
  configuration: {
    filename: 'report.pdf',
  },
  status: 'pending',
};

export const initialWorkflow: Workflow = {
  id: 'wf-2026-001',
  name: 'User Analysis Workflow',
  created_at: '2026-01-14T10:00:00Z',
  steps: [step1, step2, step3],
};

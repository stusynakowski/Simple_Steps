import type { Workflow, Step } from '../types/models';

const step0: Step = {
  id: 'step-000',
  sequence_index: 0,
  label: 'Step 0',
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

export type StepStatus = 'pending' | 'running' | 'completed' | 'error';

export interface Cell {
  row_id: number;
  column_id: string;
  value: unknown;
  display_value: string;
  metadata?: Record<string, unknown>;
}

export type StepConfiguration = Record<string, unknown>;

export interface Step {
  id: string;
  sequence_index: number;
  label: string;
  process_type: string;
  configuration: StepConfiguration;
  status: StepStatus;
  output_preview?: Cell[]; 
  // For glide datagrid, we might eventually need specific GridCell types, 
  // but for now we stick to the project spec `Cell` abstraction.
}

export interface Workflow {
  id: string;
  name: string;
  created_at: string; // ISO timestamp string
  steps: Step[];
}

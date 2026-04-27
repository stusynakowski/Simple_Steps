export type StepStatus = 'pending' | 'running' | 'completed' | 'error' | 'paused' | 'stopped';

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
  /**
   * The canonical formula string, e.g. `=filter_rows(column="score", value="5")`.
   * This is the single source of truth for what the step executes.
   * `process_type` and `configuration` are always derived FROM this.
   */
  formula: string;
  /**
   * Derived from `formula` — the operation function name. Never set directly;
   * always updated alongside `formula` via `parseFormula`.
   */
  process_type: string;
  /**
   * Derived from `formula` — the parsed args dict plus any extra metadata keys
   * (prefixed `_`, e.g. `_orchestrator`) that are not part of the formula syntax.
   */
  configuration: StepConfiguration;
  status: StepStatus;
  /** @deprecated Use `formula` instead. Kept for backward-compat during migration. */
  operation?: string;
  outputRefId?: string; // The backend reference ID for the result DataFrame
  outputRows?: number;   // Row count of the output DataFrame
  outputColumns?: string[]; // Full list of columns in the output DataFrame (for step diffing)
  output_preview?: Cell[]; 
}

export interface Workflow {
  id: string;
  name: string;
  created_at: string; // ISO timestamp string
  steps: Step[];
}

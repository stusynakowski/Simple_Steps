export type StepStatus = 'pending' | 'running' | 'completed' | 'error' | 'paused' | 'stopped';

export interface Cell {
  row_id: number;
  column_id: string;
  value: unknown;
  display_value: string;
  metadata?: Record<string, unknown>;
  /** Set for a value richer than text or a number: 'image', 'plotly', 'table',
   *  'json', 'text', or a developer's own type (backend cell_types.py). */
  cell_type?: string;
  /** A short line describing the value: "64×64 RGB image", "table 40×3". */
  summary?: string;
  /** Small inline data shown in the cell, e.g. an image thumbnail (data: URL). */
  preview?: string;
  /** Core's state for this cell (/api/view): pending, known, failed, stale, absent. */
  state?: string;
  /** Core's type for the cell's column: int, str, int | None, any, … */
  type?: string;
  /** Why a failed cell failed. */
  error?: string;
  /** Core's row id `#` (row_id is the position on screen). */
  id?: string | number;
}

/** A step's plan, as core states it (rows, columns, types, or why they're unknown). */
export interface StepPlan {
  rows?: { certainty: string; count?: number; because?: string; resolve?: string[] };
  columns?: { certainty: string; names?: string[]; because?: string };
  types?: Record<string, string>;
  [key: string]: unknown;
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
  /** Core's warnings from the last run: valid, but probably not meant (spec 009 REQ-RUN-002). */
  warnings?: string[];
  /** Rows of the last run that failed and nothing caught; they stop Run All (REQ-RUN-004). */
  uncaughtFailed?: number;
  /**
   * Set when the step's output is out of date — something it reads changed
   * since it ran — with core's reason (`input r changed`, `updated args`,
   * `r is stale`). Its output stays; re-running brings it up to date.
   */
  staleReason?: string;
  /** Core's state for the step (staged, completed, stale, failed, invalid), from the last sync or run. */
  coreState?: string;
  /** Core's reasons a step can't run or is suspect. */
  problems?: string[];
  /** The server's key for the step's view: a new one means fetch it again (/api/view). */
  viewKey?: string;
  /** The columns core plans or has, with their types. */
  viewColumns?: { name: string; type?: string }[];
  /** The step's plan, from core. */
  plan?: StepPlan;
  /**
   * The step's colour, chosen in its Settings (a CSS colour, e.g. `#22aa88`).
   * Unset = the palette colour for its position. Saved in the step's `meta`.
   */
  step_color?: string;
  /** Markdown notes on what the step is for; shown in Analytics. Saved in `meta`. */
  notes?: string;
}

export interface Workflow {
  id: string;
  name: string;
  created_at: string; // ISO timestamp string
  steps: Step[];
  meta?: Record<string, unknown>;
  /** Resources the steps use: name → {source, type, settings} (core 007). */
  resources?: Record<string, unknown>;
  /** Other top-level sections of the saved file, kept verbatim for the next save. */
  sections?: Record<string, unknown>;
}

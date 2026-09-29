import Icon from './Icon';
import './UnifiedToolbar.css';

export interface PipelineMeta {
  /** Row count of the last completed step's output. */
  rows: number;
  /** Column count of the last completed step's output. */
  cols: number;
  /** Total cells = rows × cols. */
  cells: number;
  counts: {
    staged: number;   // completed with outputRefId
    queued: number;   // pending
    running: number;
    ran: number;      // total completed
    errors: number;
  };
}

interface UnifiedToolbarProps {
  onRunAll: () => void;
  onPauseAll: () => void;
  onStopAll: () => void;
  pipelineStatus: 'idle' | 'running' | 'paused';
  logCount?: number;
  logErrorCount?: number;
  isLogOpen?: boolean;
  onToggleLogs?: () => void;
  onClearOutputs?: () => void;
  onRestartBackend?: () => void;
  pipelineMeta?: PipelineMeta;
}

export default function UnifiedToolbar({
  onRunAll,
  onPauseAll,
  onStopAll,
  pipelineStatus,
  logCount = 0,
  logErrorCount = 0,
  isLogOpen = false,
  onToggleLogs,
  onClearOutputs,
  onRestartBackend,
  pipelineMeta,
}: UnifiedToolbarProps) {
  return (
    <div className="unified-toolbar" data-testid="unified-toolbar">

      {/* ── Left: Execution controls ─────────────────────────────────── */}
      <div className="ut-group ut-execution">
        {pipelineStatus === 'running' ? (
          <button className="ut-btn ut-btn-pause" onClick={onPauseAll} title="Pause Pipeline">
            <Icon name="debug-pause" size={14} />
            <span className="ut-label">Pause</span>
          </button>
        ) : (
          <button
            className={`ut-btn ut-btn-run ${pipelineStatus === 'paused' ? 'ut-btn-resume' : ''}`}
            onClick={onRunAll}
            title={pipelineStatus === 'paused' ? 'Resume Pipeline' : 'Run Pipeline'}
          >
            <Icon name="play" size={14} />
            <span className="ut-label">{pipelineStatus === 'paused' ? 'Resume' : 'Run'}</span>
          </button>
        )}

        <button
          className="ut-btn ut-btn-stop"
          onClick={onStopAll}
          title="Stop Pipeline"
          disabled={pipelineStatus === 'idle'}
        >
          <Icon name="debug-stop" size={14} />
        </button>

        {onRestartBackend && (
          <button className="ut-btn" onClick={onRestartBackend} title="Restart Backend">
            <Icon name="debug-restart" size={14} />
          </button>
        )}

        {onClearOutputs && (
          <button className="ut-btn" onClick={onClearOutputs} title="Clear All Outputs">
            <Icon name="clear-all" size={14} />
          </button>
        )}
      </div>

      <div className="ut-divider" />

      {/* ── Center-right: Pipeline meta stats ────────────────────────── */}
      {pipelineMeta && (
        <>
          <div className="ut-divider" />
          <div className="ut-group ut-meta-group" title="Pipeline data & status summary">
            {/* Data shape: rows / cols / cells */}
            <div className="ut-meta-data">
              <span className="ut-meta-chip ut-meta-rows" title="Rows in latest output">
                <span className="ut-meta-icon">⬛</span>{pipelineMeta.rows.toLocaleString()} rows
              </span>
              <span className="ut-meta-sep">×</span>
              <span className="ut-meta-chip ut-meta-cols" title="Columns in latest output">
                {pipelineMeta.cols} cols
              </span>
              <span className="ut-meta-sep">=</span>
              <span className="ut-meta-chip ut-meta-cells" title="Total cells">
                {pipelineMeta.cells.toLocaleString()} cells
              </span>
            </div>
            <div className="ut-meta-divider" />
            {/* Step status counts */}
            <div className="ut-meta-counts">
              {pipelineMeta.counts.staged > 0 && (
                <span className="ut-meta-count ut-count-staged" title="Staged (completed with output)">
                  {pipelineMeta.counts.staged} staged
                </span>
              )}
              {pipelineMeta.counts.queued > 0 && (
                <span className="ut-meta-count ut-count-queued" title="Queued (pending)">
                  {pipelineMeta.counts.queued} queued
                </span>
              )}
              {pipelineMeta.counts.running > 0 && (
                <span className="ut-meta-count ut-count-running" title="Currently running">
                  {pipelineMeta.counts.running} running
                </span>
              )}
              {pipelineMeta.counts.ran > 0 && (
                <span className="ut-meta-count ut-count-ran" title="Total completed">
                  {pipelineMeta.counts.ran} ran
                </span>
              )}
              {pipelineMeta.counts.errors > 0 && (
                <span className="ut-meta-count ut-count-errors" title="Steps with errors">
                  {pipelineMeta.counts.errors} errors
                </span>
              )}
              {pipelineMeta.counts.staged === 0 && pipelineMeta.counts.ran === 0 && pipelineMeta.counts.running === 0 && pipelineMeta.counts.errors === 0 && (
                <span className="ut-meta-count ut-count-idle">no runs yet</span>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Right: Status + Logs ─────────────────────────────────────── */}
      <div className="ut-spacer" />

      <div className="ut-group ut-status-group">
        <div className="ut-status-pill" title="Backend connection status">
          <span className={`ut-status-dot ${pipelineStatus === 'running' ? 'running' : 'online'}`} />
          <span className="ut-status-text">
            {pipelineStatus === 'running' ? 'Running' : 'Online'}
          </span>
        </div>

        {onToggleLogs && (
          <button
            className={`ut-btn ut-btn-logs ${isLogOpen ? 'active' : ''} ${logErrorCount > 0 ? 'has-errors' : ''}`}
            onClick={onToggleLogs}
            title={isLogOpen ? 'Close Logs' : 'Open Logs'}
          >
            <Icon name="output" size={14} />
            {logCount > 0 && <span className="ut-log-count">{logCount}</span>}
            {logErrorCount > 0 && <span className="ut-error-dot" />}
          </button>
        )}
      </div>
    </div>
  );
}

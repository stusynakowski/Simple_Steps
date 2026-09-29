import Icon from './Icon';
import './UnifiedToolbar.css';

export interface PipelineMeta {
  counts: {
    running: number;
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

      {/* ── Center-right: Pipeline status counts ─────────────────────── */}
      {pipelineMeta && (pipelineMeta.counts.running > 0 || pipelineMeta.counts.errors > 0) && (
        <div className="ut-group ut-meta-group" title="Pipeline status summary">
          <div className="ut-meta-counts">
            {pipelineMeta.counts.running > 0 && (
              <span className="ut-meta-count ut-count-running" title="Currently running">
                {pipelineMeta.counts.running} running
              </span>
            )}
            {pipelineMeta.counts.errors > 0 && (
              <span className="ut-meta-count ut-count-errors" title="Steps with errors">
                {pipelineMeta.counts.errors} errors
              </span>
            )}
          </div>
        </div>
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

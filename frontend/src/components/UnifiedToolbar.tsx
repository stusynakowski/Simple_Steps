import Icon from './Icon';
import SessionStatus from './SessionStatus';
import type { Connection } from '../hooks/useConnection';
import type { LogEntry } from './ExecutionLog';
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
  pipelineMeta?: PipelineMeta;
  /** The workflow's Overview menu, first on the top row. */
  overviewMenu?: React.ReactNode;
  /** The workflow's Resources menu, after Overview on the top row. */
  resourcesMenu?: React.ReactNode;
  /** Room for more workflow components, between Resources and server status. */
  workflowSlot?: React.ReactNode;
  /** Room for more workflow info, between the run status and the log button. */
  infoSlot?: React.ReactNode;
  /** Whether this tab's session is live; shown as the server-status pill. */
  connection: Connection;
  /** The most recent log line, shown in the activity pill while running. */
  latestLog?: LogEntry;
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
  pipelineMeta,
  overviewMenu,
  resourcesMenu,
  workflowSlot,
  infoSlot,
  connection,
  latestLog,
}: UnifiedToolbarProps) {
  const running = pipelineMeta?.counts.running ?? 0;
  const errors = pipelineMeta?.counts.errors ?? 0;
  const isBusy = pipelineStatus === 'running' || running > 0;

  return (
    <div className="unified-toolbar" data-testid="unified-toolbar">

      {/* ═══ Row 1: the workflow — Overview | Resources | … | Server status ═══ */}
      <div className="ut-row ut-row-workflow" data-testid="ut-row-workflow">
        {overviewMenu}
        {overviewMenu && resourcesMenu && <div className="ut-divider" />}
        {resourcesMenu}

        <div className="ut-slot" data-testid="ut-workflow-slot">{workflowSlot}</div>

        <div className="ut-group ut-server-group">
          <SessionStatus connection={connection} />
        </div>
      </div>

      {/* ═══ Row 2: running it — Run controls | run status | … | Logs ═══ */}
      <div className="ut-row ut-row-run" data-testid="ut-row-run">
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
              <span className="ut-label">{pipelineStatus === 'paused' ? 'Resume' : 'Run Workflow'}</span>
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
        </div>

        <div className="ut-divider" />

        {/* What the run is doing right now */}
        <div className="ut-group ut-meta-group" data-testid="ut-run-status">
          {isBusy ? (
            <span
              className="ut-meta-count ut-count-running ut-activity"
              title={latestLog ? `${latestLog.timestamp}  ${latestLog.message}` : 'Running'}
            >
              {running > 0 ? `${running} running` : 'Running'}
              {latestLog && <span className="ut-activity-line">· {latestLog.message}</span>}
            </span>
          ) : (
            <span className="ut-run-idle">{pipelineStatus === 'paused' ? 'Paused' : 'Idle'}</span>
          )}
          {errors > 0 && (
            <span className="ut-meta-count ut-count-errors" title="Steps with errors">
              {errors} {errors === 1 ? 'error' : 'errors'}
            </span>
          )}
        </div>

        <div className="ut-slot" data-testid="ut-info-slot">{infoSlot}</div>

        <div className="ut-group ut-status-group">
          {onToggleLogs && (
            <button
              className={`ut-btn ut-btn-logs ${isLogOpen ? 'active' : ''} ${logErrorCount > 0 ? 'has-errors' : ''}`}
              onClick={onToggleLogs}
              title={isLogOpen ? 'Close Logs' : 'Open Logs'}
            >
              <Icon name="terminal" size={14} />
              {logCount > 0 && <span className="ut-log-count">{logCount}</span>}
              {logErrorCount > 0 && <span className="ut-error-dot" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState, useRef, useEffect } from 'react';
import './UnifiedToolbar.css';

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
}: UnifiedToolbarProps) {
  /* ── Local state for environment & resources ───────────────────────── */
  const [computeTarget, setComputeTarget] = useState('Local');
  const [pythonEnv, setPythonEnv] = useState('simple-steps-env');
  const [resources, setResources] = useState<string[]>(['OpenAI', 'Postgres']);

  /* ── Dropdown open state ───────────────────────────────────────────── */
  const [envOpen, setEnvOpen] = useState(false);
  const [resOpen, setResOpen] = useState(false);

  const envRef = useRef<HTMLDivElement>(null);
  const resRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (envRef.current && !envRef.current.contains(e.target as Node)) setEnvOpen(false);
      if (resRef.current && !resRef.current.contains(e.target as Node)) setResOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const removeResource = (name: string) => {
    setResources(prev => prev.filter(r => r !== name));
  };

  const addResource = () => {
    const newRes = prompt("Add resource (e.g. 'AWS S3', 'Redis')");
    if (newRes && newRes.trim()) {
      setResources(prev => [...prev, newRes.trim()]);
    }
  };

  /* ── Env label for collapsed state ─────────────────────────────────── */
  const envLabel = `${pythonEnv} · ${computeTarget}`;

  return (
    <div className="unified-toolbar" data-testid="unified-toolbar">

      {/* ── Left: Execution controls ─────────────────────────────────── */}
      <div className="ut-group ut-execution">
        {pipelineStatus === 'running' ? (
          <button className="ut-btn ut-btn-pause" onClick={onPauseAll} title="Pause Pipeline">
            <span className="ut-icon">⏸</span>
            <span className="ut-label">Pause</span>
          </button>
        ) : (
          <button
            className={`ut-btn ut-btn-run ${pipelineStatus === 'paused' ? 'ut-btn-resume' : ''}`}
            onClick={onRunAll}
            title={pipelineStatus === 'paused' ? 'Resume Pipeline' : 'Run Pipeline'}
          >
            <span className="ut-icon">▶</span>
            <span className="ut-label">{pipelineStatus === 'paused' ? 'Resume' : 'Run'}</span>
          </button>
        )}

        <button
          className="ut-btn ut-btn-stop"
          onClick={onStopAll}
          title="Stop Pipeline"
          disabled={pipelineStatus === 'idle'}
        >
          <span className="ut-icon">⏹</span>
        </button>

        {onRestartBackend && (
          <button className="ut-btn" onClick={onRestartBackend} title="Restart Backend">
            <span className="ut-icon">⟳</span>
          </button>
        )}

        {onClearOutputs && (
          <button className="ut-btn" onClick={onClearOutputs} title="Clear All Outputs">
            <span className="ut-icon">🧹</span>
          </button>
        )}
      </div>

      <div className="ut-divider" />

      {/* ── Center: Environment dropdown ─────────────────────────────── */}
      <div className="ut-group ut-env-group" ref={envRef}>
        <button
          className={`ut-dropdown-trigger ${envOpen ? 'active' : ''}`}
          onClick={() => { setEnvOpen(v => !v); setResOpen(false); }}
          title="Environment Settings"
        >
          <span className="ut-icon">⚙</span>
          <span className="ut-label">{envLabel}</span>
          <span className="ut-caret">{envOpen ? '▴' : '▾'}</span>
        </button>

        {envOpen && (
          <div className="ut-dropdown-panel ut-env-panel">
            <div className="ut-panel-title">Environment</div>

            <div className="ut-field">
              <label className="ut-field-label">Compute</label>
              <select
                className="ut-select"
                value={computeTarget}
                onChange={e => setComputeTarget(e.target.value)}
              >
                <option value="Local">Local</option>
                <option value="Remote">Remote Cluster</option>
                <option value="Cloud">Cloud Runner</option>
              </select>
            </div>

            <div className="ut-field">
              <label className="ut-field-label">Python Env</label>
              <select
                className="ut-select"
                value={pythonEnv}
                onChange={e => setPythonEnv(e.target.value)}
              >
                <option value="simple-steps-env">simple-steps-env (3.11)</option>
                <option value="base">base (3.10)</option>
                <option value="data-sci">data-sci (3.12)</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* ── Center: Resources dropdown ───────────────────────────────── */}
      <div className="ut-group ut-res-group" ref={resRef}>
        <button
          className={`ut-dropdown-trigger ${resOpen ? 'active' : ''}`}
          onClick={() => { setResOpen(v => !v); setEnvOpen(false); }}
          title="Connected Resources"
        >
          <span className="ut-icon">🔌</span>
          <span className="ut-label">Resources</span>
          {resources.length > 0 && (
            <span className="ut-badge">{resources.length}</span>
          )}
          <span className="ut-caret">{resOpen ? '▴' : '▾'}</span>
        </button>

        {resOpen && (
          <div className="ut-dropdown-panel ut-res-panel">
            <div className="ut-panel-title">Connected Resources</div>

            {resources.length === 0 && (
              <div className="ut-empty">No resources configured</div>
            )}

            <div className="ut-resource-list">
              {resources.map(r => (
                <div key={r} className="ut-resource-row">
                  <span className="ut-resource-dot" />
                  <span className="ut-resource-name">{r}</span>
                  <button
                    className="ut-resource-remove"
                    onClick={() => removeResource(r)}
                    title={`Remove ${r}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <button className="ut-resource-add-btn" onClick={addResource}>
              + Add Resource
            </button>
          </div>
        )}
      </div>

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
            <span className="ut-icon">📋</span>
            {logCount > 0 && <span className="ut-log-count">{logCount}</span>}
            {logErrorCount > 0 && <span className="ut-error-dot" />}
          </button>
        )}
      </div>
    </div>
  );
}

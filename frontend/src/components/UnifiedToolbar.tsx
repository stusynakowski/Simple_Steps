import { useState, useRef, useEffect, useMemo } from 'react';
import type { OperationDefinition } from '../services/api';
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
  availableOperations?: OperationDefinition[];
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
  availableOperations = [],
  pipelineMeta,
}: UnifiedToolbarProps) {
  /* ── Local state for environment & resources ───────────────────────── */
  const [computeTarget, setComputeTarget] = useState('Local');
  const [pythonEnv, setPythonEnv] = useState('simple-steps-env');

  /* ── Dropdown open state ───────────────────────────────────────────── */
  const [envOpen, setEnvOpen] = useState(false);
  const [resOpen, setResOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const envRef = useRef<HTMLDivElement>(null);
  const resRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (envRef.current && !envRef.current.contains(e.target as Node)) setEnvOpen(false);
      if (resRef.current && !resRef.current.contains(e.target as Node)) {
        setResOpen(false);
        setFilterText('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* ── Group operations by category ──────────────────────────────────── */
  const filteredOps = useMemo(() => {
    if (!filterText) return availableOperations;
    const lower = filterText.toLowerCase();
    return availableOperations.filter(op =>
      op.id.toLowerCase().includes(lower) ||
      op.label.toLowerCase().includes(lower) ||
      op.category.toLowerCase().includes(lower)
    );
  }, [availableOperations, filterText]);

  const groupedOps = useMemo(() => {
    const acc: Record<string, OperationDefinition[]> = {};
    for (const op of filteredOps) {
      const cat = op.category || 'Uncategorized';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(op);
    }
    return acc;
  }, [filteredOps]);

  const sortedCategories = useMemo(() => Object.keys(groupedOps).sort(), [groupedOps]);

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  // Type badge colors
  const typeBadgeColors: Record<string, string> = {
    source: '#4ec9b0',
    map: '#569cd6',
    filter: '#ce9178',
    dataframe: '#b5cea8',
    expand: '#d7ba7d',
    raw_output: '#c586c0',
    orchestrator: '#9cdcfe',
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

      {/* ── Center: Resources dropdown (Function Registry) ────────────── */}
      <div className="ut-group ut-res-group" ref={resRef}>
        <button
          className={`ut-dropdown-trigger ${resOpen ? 'active' : ''}`}
          onClick={() => { setResOpen(v => !v); setEnvOpen(false); if (resOpen) setFilterText(''); }}
          title="Function Registry — All registered operations"
        >
          <span className="ut-icon">�</span>
          <span className="ut-label">Resources</span>
          {availableOperations.length > 0 && (
            <span className="ut-badge">{availableOperations.length}</span>
          )}
          <span className="ut-caret">{resOpen ? '▴' : '▾'}</span>
        </button>

        {resOpen && (
          <div className="ut-dropdown-panel ut-res-panel ut-registry-panel">
            <div className="ut-panel-title">Function Registry</div>

            {/* Filter input */}
            <div className="ut-registry-filter">
              <input
                type="text"
                className="ut-registry-filter-input"
                placeholder="Filter functions…"
                value={filterText}
                onChange={e => setFilterText(e.target.value)}
                autoFocus
              />
              {filterText && (
                <button className="ut-registry-filter-clear" onClick={() => setFilterText('')}>×</button>
              )}
            </div>

            {availableOperations.length === 0 && (
              <div className="ut-empty">No functions registered — is the backend running?</div>
            )}

            {filteredOps.length === 0 && availableOperations.length > 0 && (
              <div className="ut-empty">No matches for "{filterText}"</div>
            )}

            <div className="ut-registry-list">
              {sortedCategories.map(cat => {
                const ops = groupedOps[cat];
                const isCatOpen = expandedCategories.has(cat);
                return (
                  <div key={cat} className="ut-registry-category">
                    <div className="ut-registry-category-row" onClick={() => toggleCategory(cat)}>
                      <span className={`ut-registry-chevron ${!isCatOpen ? 'collapsed' : ''}`}>▼</span>
                      <span className="ut-registry-category-label">{cat}</span>
                      <span className="ut-registry-category-count">{ops.length}</span>
                    </div>
                    {isCatOpen && (
                      <div className="ut-registry-ops">
                        {ops.map(op => (
                          <div key={op.id} className="ut-registry-op-row" title={op.description || op.id}>
                            <span className="ut-registry-fn-icon">ƒ</span>
                            <span className="ut-registry-op-name">{op.label}</span>
                            <span
                              className="ut-registry-type-badge"
                              style={{ background: typeBadgeColors[op.type] || '#666' }}
                            >
                              {op.type}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

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
            <span className="ut-icon">📋</span>
            {logCount > 0 && <span className="ut-log-count">{logCount}</span>}
            {logErrorCount > 0 && <span className="ut-error-dot" />}
          </button>
        )}
      </div>
    </div>
  );
}

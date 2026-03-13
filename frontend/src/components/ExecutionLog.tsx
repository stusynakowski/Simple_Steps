import { useState, useRef, useEffect } from 'react';
import './ExecutionLog.css';

export type LogLevel = 'info' | 'warn' | 'error' | 'success' | 'debug';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  stepId?: string;
  stepLabel?: string;
  operationId?: string;
  message: string;
  detail?: string;       // Expanded detail (e.g. traceback, full config)
  durationMs?: number;
}

interface ExecutionLogProps {
  logs: LogEntry[];
  onClear?: () => void;
  isOpen: boolean;
  onClose: () => void;
  rightOffset?: number;
}

const LEVEL_ICONS: Record<LogLevel, string> = {
  info: 'ℹ️',
  warn: '⚠️',
  error: '❌',
  success: '✅',
  debug: '🔍',
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  info: '#90caf9',
  warn: '#ffe082',
  error: '#ef9a9a',
  success: '#a5d6a7',
  debug: '#b0bec5',
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      + '.' + String(d.getMilliseconds()).padStart(3, '0');
  } catch {
    return iso;
  }
}

export default function ExecutionLog({ logs, onClear, isOpen, onClose, rightOffset = 16 }: ExecutionLogProps) {
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<LogLevel | 'all'>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && isOpen && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isOpen, autoScroll]);

  const toggleEntry = (id: string) => {
    setExpandedEntries(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = filter === 'all' ? logs : logs.filter(l => l.level === filter);

  const errorCount = logs.filter(l => l.level === 'error').length;
  const warnCount = logs.filter(l => l.level === 'warn').length;

  return (
    <>
      {/* ── Overlay panel ────────────────────────────────────────────── */}
      {isOpen && (
        <div className="execution-log-overlay" style={{ right: rightOffset }}>
          {/* Header */}
          <div className="execution-log-header">
            <div className="execution-log-header-left">
              <span className="execution-log-title">Execution Log</span>
              <span className="execution-log-count">{logs.length} entries</span>
              {errorCount > 0 && (
                <span className="execution-log-badge error-badge">{errorCount} error{errorCount > 1 ? 's' : ''}</span>
              )}
              {warnCount > 0 && (
                <span className="execution-log-badge warn-badge">{warnCount} warning{warnCount > 1 ? 's' : ''}</span>
              )}
            </div>
            <div className="execution-log-header-right">
              <select
                className="log-filter-select"
                value={filter}
                onChange={(e) => setFilter(e.target.value as LogLevel | 'all')}
              >
                <option value="all">All</option>
                <option value="error">Errors</option>
                <option value="warn">Warnings</option>
                <option value="info">Info</option>
                <option value="success">Success</option>
                <option value="debug">Debug</option>
              </select>
              <label className="auto-scroll-label">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                />
                Auto-scroll
              </label>
              <button className="log-clear-btn" onClick={onClear} title="Clear all logs">
                🗑️ Clear
              </button>
              <button className="log-close-btn" onClick={onClose} title="Close">
                ✕
              </button>
            </div>
          </div>

          {/* Log entries */}
          <div className="execution-log-body" ref={scrollContainerRef}>
            {filtered.length === 0 && (
              <div className="execution-log-empty">
                {logs.length === 0
                  ? 'No execution logs yet. Run a step or pipeline to see logs here.'
                  : `No ${filter} entries.`}
              </div>
            )}
            {filtered.map((entry) => {
              const isEntryExpanded = expandedEntries.has(entry.id);
              return (
                <div
                  key={entry.id}
                  className={`log-entry level-${entry.level} ${isEntryExpanded ? 'entry-expanded' : ''}`}
                  onClick={() => entry.detail && toggleEntry(entry.id)}
                  style={{ cursor: entry.detail ? 'pointer' : 'default' }}
                >
                  <div className="log-entry-main">
                    <span className="log-time">{formatTime(entry.timestamp)}</span>
                    <span className="log-icon">{LEVEL_ICONS[entry.level]}</span>
                    {entry.stepLabel && (
                      <span className="log-step-badge" style={{ borderColor: LEVEL_COLORS[entry.level] }}>
                        {entry.stepLabel}
                      </span>
                    )}
                    {entry.operationId && (
                      <span className="log-op-badge">{entry.operationId}</span>
                    )}
                    <span className="log-message">{entry.message}</span>
                    {entry.durationMs != null && (
                      <span className="log-duration">{entry.durationMs}ms</span>
                    )}
                    {entry.detail && (
                      <span className="log-expand-hint">{isEntryExpanded ? '▾' : '▸'}</span>
                    )}
                  </div>
                  {isEntryExpanded && entry.detail && (
                    <pre className="log-entry-detail">{entry.detail}</pre>
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        </div>
      )}
    </>
  );
}

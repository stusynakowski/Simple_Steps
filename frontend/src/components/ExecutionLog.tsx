import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
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

/**
 * Where the log lives.
 *
 * `docked` — the default. The log is an `Allotment.Pane` at the bottom of the
 * centre column, so it is resized by dragging the divider above it and
 * collapsed to its header by the chevron. It owns no geometry of its own;
 * `MainLayout` sizes the pane.
 *
 * `floating` — a free window over the canvas, dragged by its header and
 * resized from any edge or corner. Dragging it onto the bottom edge of the
 * window re-docks it.
 */
export type LogMode = 'docked' | 'floating';

interface ExecutionLogProps {
  logs: LogEntry[];
  onClear?: () => void;
  isOpen: boolean;
  onClose: () => void;
  /** Docked (a layout pane) or floating (a draggable window). */
  mode?: LogMode;
  /** Docked only — true when the pane is clamped to its header. */
  collapsed?: boolean;
  /** Docked only — chevron handler. */
  onToggleCollapse?: () => void;
  /** Leave the pane and become a floating window. */
  onPopOut?: () => void;
  /** Return to the bottom pane. */
  onDock?: () => void;
  /** Width of the right-hand pane, so a new floating window clears it. */
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

// ── Floating-window geometry ────────────────────────────────────────────────
const FLOAT_W = 700;
const FLOAT_H = 320;
const MIN_W = 360;
const MIN_H = 140;
/** Dropping the window within this many px of the bottom edge re-docks it. */
const DOCK_SNAP_PX = 72;

const RESIZE_DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      + '.' + String(d.getMilliseconds()).padStart(3, '0');
  } catch {
    return iso;
  }
}

export default function ExecutionLog({
  logs,
  onClear,
  isOpen,
  onClose,
  mode = 'docked',
  collapsed = false,
  onToggleCollapse,
  onPopOut,
  onDock,
  rightOffset = 16,
}: ExecutionLogProps) {
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<LogLevel | 'all'>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const isFloating = mode === 'floating';
  // A floating window is never "collapsed" — that is a docked-pane affordance.
  const isCollapsed = !isFloating && collapsed;

  // ── Floating geometry ─────────────────────────────────────────────────────
  // Seeded on first pop-out so the window appears roughly where the old
  // overlay used to sit (bottom-right, clear of the chat pane).
  const [pos, setPos] = useState(() => ({
    x: Math.max(16, window.innerWidth - FLOAT_W - rightOffset),
    y: Math.max(16, window.innerHeight - FLOAT_H - 72),
  }));
  const [size, setSize] = useState({ width: FLOAT_W, height: FLOAT_H });
  const [dockPreview, setDockPreview] = useState(false);

  const isDragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const isResizing = useRef(false);
  const resizeDir = useRef<string>('');
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0, px: 0, py: 0 });

  // Re-seed the position each time the log becomes floating, so popping out
  // twice in a session doesn't leave the window off-screen after a resize.
  useEffect(() => {
    if (!isFloating) return;
    setPos((p) => ({
      x: Math.min(Math.max(8, p.x), Math.max(8, window.innerWidth - MIN_W)),
      y: Math.min(Math.max(8, p.y), Math.max(8, window.innerHeight - MIN_H)),
    }));
  }, [isFloating]);

  const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isFloating) return;
    // Never start a drag from the header's own controls.
    if ((e.target as HTMLElement).closest('button, select, input, label')) return;
    isDragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  }, [isFloating, pos]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent, dir: string) => {
    isResizing.current = true;
    resizeDir.current = dir;
    resizeStart.current = {
      x: e.clientX, y: e.clientY,
      w: size.width, h: size.height,
      px: pos.x, py: pos.y,
    };
    e.preventDefault();
    e.stopPropagation();
  }, [pos, size]);

  useEffect(() => {
    if (!isFloating) return;

    const onMouseMove = (e: MouseEvent) => {
      if (isDragging.current) {
        setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
        setDockPreview(e.clientY >= window.innerHeight - DOCK_SNAP_PX);
      }
      if (isResizing.current) {
        const dx = e.clientX - resizeStart.current.x;
        const dy = e.clientY - resizeStart.current.y;
        const dir = resizeDir.current;
        let { w: newW, h: newH, px: newX, py: newY } = resizeStart.current;

        if (dir.includes('e')) newW = Math.max(MIN_W, resizeStart.current.w + dx);
        if (dir.includes('s')) newH = Math.max(MIN_H, resizeStart.current.h + dy);
        if (dir.includes('w')) {
          newW = Math.max(MIN_W, resizeStart.current.w - dx);
          newX = resizeStart.current.px + (resizeStart.current.w - newW);
        }
        if (dir.includes('n')) {
          newH = Math.max(MIN_H, resizeStart.current.h - dy);
          newY = resizeStart.current.py + (resizeStart.current.h - newH);
        }
        setSize({ width: newW, height: newH });
        setPos({ x: newX, y: newY });
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      // Released over the bottom edge → go back to being a pane.
      if (isDragging.current && e.clientY >= window.innerHeight - DOCK_SNAP_PX) {
        onDock?.();
      }
      isDragging.current = false;
      isResizing.current = false;
      setDockPreview(false);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isFloating, onDock]);

  // Auto-scroll to bottom — skipped while collapsed, since the body is hidden.
  useEffect(() => {
    if (autoScroll && isOpen && !isCollapsed && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isOpen, autoScroll, isCollapsed]);

  const toggleEntry = (id: string) => {
    setExpandedEntries(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!isOpen) return null;

  const filtered = filter === 'all' ? logs : logs.filter(l => l.level === filter);
  const errorCount = logs.filter(l => l.level === 'error').length;
  const warnCount = logs.filter(l => l.level === 'warn').length;

  const header = (
    <div
      className={`execution-log-header${isFloating ? ' is-draggable' : ''}`}
      onMouseDown={handleHeaderMouseDown}
      onDoubleClick={() => { if (!isFloating) onToggleCollapse?.(); }}
    >
      <div className="execution-log-header-left">
        {!isFloating && (
          <button
            className="log-collapse-btn"
            onClick={onToggleCollapse}
            title={isCollapsed ? 'Expand log' : 'Collapse log'}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
        )}
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
        {!isCollapsed && (
          <>
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
          </>
        )}
        <button
          className="log-dock-btn"
          onClick={isFloating ? onDock : onPopOut}
          title={isFloating ? 'Dock to bottom' : 'Pop out into a floating window'}
          aria-label={isFloating ? 'Dock log to bottom' : 'Pop log out'}
        >
          {isFloating ? '⤓' : '⧉'}
        </button>
        <button className="log-close-btn" onClick={onClose} title="Close">
          ✕
        </button>
      </div>
    </div>
  );

  const body = (
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
  );

  // ── Docked: fill the pane MainLayout gave us ──────────────────────────────
  if (!isFloating) {
    return (
      <div
        className={`execution-log execution-log-docked${isCollapsed ? ' is-collapsed' : ''}`}
        data-testid="execution-log"
      >
        {header}
        {!isCollapsed && body}
      </div>
    );
  }

  // ── Floating: our own geometry, over the canvas ───────────────────────────
  // Rendered through a portal so this component keeps its position in the
  // React tree (inside the now-hidden Allotment pane). Docking and undocking
  // therefore moves DOM nodes, not component instances, and the active filter
  // and scroll position survive the switch.
  return createPortal(
    <>
      {dockPreview && <div className="execution-log-dock-preview" aria-hidden="true" />}
      <div
        className="execution-log execution-log-floating"
        style={{ left: pos.x, top: pos.y, width: size.width, height: size.height }}
        data-testid="execution-log"
      >
        {header}
        {body}
        {RESIZE_DIRS.map((d) => (
          <div
            key={d}
            className={`log-resize log-resize-${d}`}
            onMouseDown={(e) => handleResizeMouseDown(e, d)}
          />
        ))}
      </div>
    </>,
    document.body,
  );
}

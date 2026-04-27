import { useEffect, useRef, useState, useCallback } from 'react';
import type { Step } from '../types/models';
import type { OperationDefinition } from '../services/api';
import OperationColumn from './OperationColumn';
import './DetachedStepWindow.css';

type SnapZone = 'left' | 'right' | 'top' | null;

interface DetachedStepWindowProps {
  step: Step;
  stepIndex: number;
  previousSteps: Step[];
  availableOperations: OperationDefinition[];
  pipelineStatus?: 'idle' | 'running' | 'paused';
  pipelineCursorIndex?: number;
  color: string;
  initialPosition: { x: number; y: number };
  onClose: () => void;
  onUpdate?: (id: string, updates: Partial<Step>) => void;
  onRun: (id: string) => void;
  onPreview?: (id: string) => void;
  onDelete: (id: string) => void;
}

/** Returns which snap zone the cursor is in, or null */
function getSnapZone(x: number, y: number, threshold = 80): SnapZone {
  if (x <= threshold) return 'left';
  if (x >= window.innerWidth - threshold) return 'right';
  if (y <= threshold) return 'top';
  return null;
}

/** Geometry for a committed snap */
function snapGeometry(zone: SnapZone): { x: number; y: number; w: number; h: number } {
  const W = window.innerWidth;
  const H = window.innerHeight;
  if (zone === 'left')  return { x: 0,     y: 0, w: W / 2, h: H };
  if (zone === 'right') return { x: W / 2, y: 0, w: W / 2, h: H };
  if (zone === 'top')   return { x: 0,     y: 0, w: W,     h: H / 2 };
  return { x: 0, y: 0, w: W, h: H };
}

export default function DetachedStepWindow({
  step,
  stepIndex,
  previousSteps,
  availableOperations,
  pipelineStatus = 'idle',
  pipelineCursorIndex = -1,
  color,
  initialPosition,
  onClose,
  onUpdate,
  onRun,
  onPreview,
  onDelete,
}: DetachedStepWindowProps) {
  const [pos, setPos] = useState(initialPosition);
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [snapped, setSnapped] = useState<SnapZone>(null);
  const [snapPreview, setSnapPreview] = useState<SnapZone>(null);
  const [size, setSize] = useState({ width: 420, height: 560 });

  // Remember pre-maximized / pre-snapped geometry so we can restore it
  const preMaximized = useRef<{ pos: { x: number; y: number }; size: { width: number; height: number } } | null>(null);
  const preSnapped   = useRef<{ pos: { x: number; y: number }; size: { width: number; height: number } } | null>(null);
  // Geometry to restore when un-minimizing from a maximized/snapped state
  const preMinimized = useRef<{ pos: { x: number; y: number }; size: { width: number; height: number }; snapped: SnapZone; maximized: boolean } | null>(null);

  // Drag state
  const isDragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Resize state
  const isResizing = useRef(false);
  const resizeDir = useRef<string>('');
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0, px: 0, py: 0 });

  // Bring window to front on click
  const [zIndex, setZIndex] = useState(2000);

  const handleTitleBarMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag on left click, not on buttons, and not when maximized
    if ((e.target as HTMLElement).closest('button')) return;
    if (maximized) return;
    isDragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    setZIndex(z => z + 1);

    // If dragging away from a snapped position, restore the pre-snap size first
    if (snapped && preSnapped.current) {
      setSize(preSnapped.current.size);
      // Re-anchor so the window follows the cursor naturally
      dragOffset.current = {
        x: preSnapped.current.size.width / 2,
        y: 18,
      };
      setSnapped(null);
      preSnapped.current = null;
    }

    e.preventDefault();
  }, [pos, maximized, snapped]);

  const handleMinimize = useCallback(() => {
    if (!minimized) {
      // Going into minimized: save current mode, then collapse to free-floating title bar
      preMinimized.current = { pos, size, snapped, maximized };
      // Exit maximized/snapped so CSS classes don't override the collapsed height
      setMaximized(false);
      setSnapped(null);
      preMaximized.current = null;
      preSnapped.current = null;
      // Restore the free-floating size so the title bar has the right width
      setSize({ width: 420, height: 560 });
      setPos(pos);
      setMinimized(true);
    } else {
      // Restoring: put everything back exactly as it was
      setMinimized(false);
      if (preMinimized.current) {
        setPos(preMinimized.current.pos);
        setSize(preMinimized.current.size);
        setSnapped(preMinimized.current.snapped);
        setMaximized(preMinimized.current.maximized);
        preMinimized.current = null;
      }
    }
  }, [minimized, pos, size, snapped, maximized]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent, dir: string) => {
    isResizing.current = true;
    resizeDir.current = dir;
    resizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      w: size.width,
      h: size.height,
      px: pos.x,
      py: pos.y,
    };
    setZIndex(z => z + 1);
    e.preventDefault();
    e.stopPropagation();
  }, [size, pos]);

  const toggleMaximize = useCallback(() => {
    setMaximized(prev => {
      if (!prev) {
        // Save current geometry, then go full-screen
        preMaximized.current = { pos, size };
        setPos({ x: 0, y: 0 });
        setSize({ width: window.innerWidth, height: window.innerHeight });
        setMinimized(false);
        setSnapped(null);
      } else {
        // Restore saved geometry
        if (preMaximized.current) {
          setPos(preMaximized.current.pos);
          setSize(preMaximized.current.size);
        }
        preMaximized.current = null;
      }
      return !prev;
    });
  }, [pos, size]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (isDragging.current) {
        const newX = e.clientX - dragOffset.current.x;
        const newY = e.clientY - dragOffset.current.y;
        setPos({ x: newX, y: newY });

        // Show snap preview when cursor nears an edge
        setSnapPreview(getSnapZone(e.clientX, e.clientY));
      }
      if (isResizing.current) {
        const dx = e.clientX - resizeStart.current.x;
        const dy = e.clientY - resizeStart.current.y;
        const dir = resizeDir.current;
        let newW = resizeStart.current.w;
        let newH = resizeStart.current.h;
        let newX = resizeStart.current.px;
        let newY = resizeStart.current.py;

        if (dir.includes('e')) newW = Math.max(320, resizeStart.current.w + dx);
        if (dir.includes('s')) newH = Math.max(200, resizeStart.current.h + dy);
        if (dir.includes('w')) {
          newW = Math.max(320, resizeStart.current.w - dx);
          newX = resizeStart.current.px + (resizeStart.current.w - newW);
        }
        if (dir.includes('n')) {
          newH = Math.max(200, resizeStart.current.h - dy);
          newY = resizeStart.current.py + (resizeStart.current.h - newH);
        }

        setSize({ width: newW, height: newH });
        setPos({ x: newX, y: newY });
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (isDragging.current) {
        // Commit snap if cursor released in a snap zone
        const zone = getSnapZone(e.clientX, e.clientY);
        if (zone) {
          const geo = snapGeometry(zone);
          preSnapped.current = { pos, size };
          setPos({ x: geo.x, y: geo.y });
          setSize({ width: geo.w, height: geo.h });
          setSnapped(zone);
        }
        setSnapPreview(null);
      }
      isDragging.current = false;
      isResizing.current = false;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  // pos/size refs inside the closure are read at mouseup time via state —
  // we capture them via the closure update below
  }, [pos, size]);

  // Derive CSS classes
  const windowClasses = [
    'detached-step-window',
    maximized          ? 'dsw-maximized' : '',
    snapped            ? `dsw-snapped dsw-snapped-${snapped}` : '',
  ].filter(Boolean).join(' ');

  const isLocked = maximized || !!snapped;

  return (
    <>
      {/* Snap preview ghost overlay — shown while dragging near an edge */}
      {snapPreview && (
        <div
          className={`dsw-snap-preview dsw-snap-preview-${snapPreview}`}
          style={{ zIndex: zIndex - 1 }}
        />
      )}

      <div
        className={windowClasses}
        style={{
          left: pos.x,
          top: pos.y,
          width:  isLocked ? undefined : size.width,
          height: minimized ? 'auto' : (isLocked ? undefined : size.height),
          zIndex,
        }}
        onClick={() => setZIndex(z => Math.max(z, 2000))}
      >
        {/* Title bar */}
        <div
          className="dsw-titlebar"
          style={{ '--step-color': color } as React.CSSProperties}
          onMouseDown={handleTitleBarMouseDown}
          onDoubleClick={toggleMaximize}
        >
          <div className="dsw-titlebar-label">
            <span className="dsw-step-dot" style={{ background: color }} />
            <span className="dsw-step-name">{step.label}</span>
            <span className={`dsw-badge${snapped ? ' dsw-badge-snapped' : ''}`}>
              {snapped ? `snapped ${snapped}` : 'detached'}
            </span>
          </div>
          <div className="dsw-titlebar-actions">
            <button
              className="dsw-btn"
              title={minimized ? 'Restore' : 'Minimize'}
              onClick={handleMinimize}
            >
              {minimized ? '□' : '—'}
            </button>
            <button
              className="dsw-btn"
              title={maximized ? 'Restore window' : 'Maximize window'}
              onClick={toggleMaximize}
            >
              {maximized ? '❐' : '⛶'}
            </button>
            <button
              className="dsw-btn dsw-btn-close"
              title="Close detached window"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body — shows the full OperationColumn, always active */}
        {!minimized && (
          <div className="dsw-body">
            <OperationColumn
              step={step}
              stepIndex={stepIndex}
              previousSteps={previousSteps}
              availableOperations={availableOperations}
              pipelineStatus={pipelineStatus}
              pipelineCursorIndex={pipelineCursorIndex}
              color={color}
              isActive={true}
              isSqueezed={false}
              isMaximized={maximized || !!snapped}
              zIndex={1}
              onActivate={() => {/* always active in detached */}}
              onUpdate={onUpdate}
              onRun={onRun}
              onPreview={onPreview}
              onPause={() => {/* no-op in detached */}}
              onDelete={onDelete}
            />
          </div>
        )}

        {/* Resize handles — hidden when maximized or snapped */}
        {!minimized && !isLocked && (
          <>
            <div className="dsw-resize dsw-resize-e"  onMouseDown={e => handleResizeMouseDown(e, 'e')} />
            <div className="dsw-resize dsw-resize-s"  onMouseDown={e => handleResizeMouseDown(e, 's')} />
            <div className="dsw-resize dsw-resize-w"  onMouseDown={e => handleResizeMouseDown(e, 'w')} />
            <div className="dsw-resize dsw-resize-n"  onMouseDown={e => handleResizeMouseDown(e, 'n')} />
            <div className="dsw-resize dsw-resize-se" onMouseDown={e => handleResizeMouseDown(e, 'se')} />
            <div className="dsw-resize dsw-resize-sw" onMouseDown={e => handleResizeMouseDown(e, 'sw')} />
            <div className="dsw-resize dsw-resize-ne" onMouseDown={e => handleResizeMouseDown(e, 'ne')} />
            <div className="dsw-resize dsw-resize-nw" onMouseDown={e => handleResizeMouseDown(e, 'nw')} />
          </>
        )}
      </div>
    </>
  );
}



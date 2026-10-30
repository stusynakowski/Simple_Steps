import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Cell } from '../types/models';
import { useInspectors } from '../context/InspectorContext';
import type { Inspector } from '../context/InspectorContext';
import { fetchCellView, fetchDataMeta, fetchDataView } from '../services/api';
import { textOn } from '../utils/contrast';
import { isErrorCell } from '../utils/errorCells';
import { inGridSel } from '../utils/gridSelection';
import CellViewer from './CellViewer';
import SymbolIcon from './SymbolIcon';
import type { SymbolName } from './SymbolIcon';
import './SelectionInspector.css';

/**
 * The selection inspector (spec 014 §8): the data a person clicked or
 * selected, enlarged, opened in place over it.
 *
 * - Opens **in place** (docked), over the selection, following it as the
 *   page scrolls. Dragging its header bar pulls it off into a floating
 *   window.
 * - The header bar is the step's colour: the step's name and the
 *   selection's rows and columns; clicking it expands it to the full
 *   expression and state, never cut short. Its right end holds the window
 *   controls, as on a cell's display: pull off / put back, expand over the
 *   window (Esc restores), minimize (into the steps bar), close.
 * - Its sides are the wiring (dev_plan/124 phase 2): inputs →ƒ(x) on the
 *   left, outputs ƒ(x)→ on the right.
 * - It resizes from its corner. One cell is its value alone; a cell with an
 *   interactive display (a chart, an image, a table) is that display, filling
 *   the inspector, with all its own interaction.
 * - It stays open until closed: clicking elsewhere leaves it be.
 * - A column, the whole table or the index means every row of the step, not
 *   just the rows the grid has loaded: those rows are fetched (to WHOLE_CAP).
 *
 * Events inside stop here, so a click in it never selects in the grid.
 */

const MARGIN = 8;
/** The most rows a whole-column inspector fetches. */
const WHOLE_CAP = 5000;
/** A press on the header that moves further than this is a drag, not a click. */
const DRAG_SLOP = 4;
/** Where an interactive display opens: big enough to use, resizable. */
const DISPLAY_SIZE = { width: 640, height: 460 };
/** The most images one inspector draws: a selection of more shows the rest
 *  as their icon and summary (owner, 2026-10-30). */
const MAX_IMAGES = 12;

/** One image of a selection, fetched and drawn only now that it's inspected. */
function InspectImage({ refId, row, column, summary }: { refId: string; row: number; column: string; summary: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetchCellView(refId, row, column)
      .then((v) => { if (live && v.view.kind === 'image') setSrc(v.view.src); })
      .catch(() => {});
    return () => { live = false; };
  }, [refId, row, column]);
  return src
    ? <img className="si-image" src={src} alt={summary} title={summary} />
    : <span className="si-image-pending"><SymbolIcon name="image" size={14} /> {summary}</span>;
}

interface WholeRows { rows: number[]; cells: Record<string, Cell>; total: number }

/** A window control in the header bar. */
function HeaderButton({ icon, label, onClick, disabled }: {
  icon: SymbolName; label: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button type="button" className="si-header-btn" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      <SymbolIcon name={icon} size={14} />
    </button>
  );
}

/** A tool in the header's second row: the wiring, →ƒ(x) inputs or ƒ(x)→ outputs.
 *  Tools that open inside the frame (a quick plot, image analysis) join it later. */
function Tool({ side, label }: { side: 'inputs' | 'outputs'; label: string }) {
  return (
    <button type="button" className="si-tool" aria-label={label} title={label} disabled>
      {side === 'inputs' && <span className="si-arrow" aria-hidden="true">→</span>}
      <SymbolIcon name="function" size={13} />
      {side === 'outputs' && <span className="si-arrow" aria-hidden="true">→</span>}
    </button>
  );
}

export default function SelectionInspector({ inspector }: { inspector: Inspector }) {
  const ctx = useInspectors()!;
  const {
    id, mode, stepName, color, formula, what, refId, wholeColumns, cols, sel,
    rows: loadedRows, cells: loadedCells,
  } = inspector;
  const ref = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(inspector.pos);
  const [expanded, setExpanded] = useState(false);
  const [maximized, setMaximized] = useState(false);

  // ── Where it is ──────────────────────────────────────────────────────────
  const clamp = (x: number, y: number) => {
    const w = ref.current?.offsetWidth ?? 0;
    const h = ref.current?.offsetHeight ?? 0;
    return {
      x: Math.min(Math.max(MARGIN, x), Math.max(MARGIN, window.innerWidth - w - MARGIN)),
      y: Math.min(Math.max(MARGIN, y), Math.max(MARGIN, window.innerHeight - h - MARGIN)),
    };
  };

  // Docked: over the selection, its header bar just above it; follows the
  // page as it scrolls or resizes. If the selection isn't drawn any more (its
  // step collapsed), it floats where it is.
  useLayoutEffect(() => {
    if (mode !== 'docked' || maximized) return;
    const follow = () => {
      const r = ctx.anchorOf(inspector);
      if (!r) { ctx.update(id, { mode: 'floating', pos }); return; }
      const next = clamp(r.left - 1, r.top - (headerRef.current?.offsetHeight ?? 0));
      setPos((p) => (p && p.x === next.x && p.y === next.y ? p : next));
    };
    follow();
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, inspector, expanded, maximized]);

  // Floating with no position yet: a third of the way in.
  useLayoutEffect(() => {
    if (mode === 'floating' && !pos) setPos(clamp(window.innerWidth / 3, window.innerHeight / 4));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Esc puts an expanded inspector back.
  useEffect(() => {
    if (!maximized) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMaximized(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [maximized]);

  // ── Header bar: drag pulls off and moves; a click expands ────────────────
  const press = useRef<{ x: number; y: number; dx: number; dy: number; moved: boolean } | null>(null);
  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if (!pos || e.button !== 0 || maximized || (e.target as HTMLElement).closest('button')) return;
    press.current = { x: e.clientX, y: e.clientY, dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onHeaderPointerMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p) return;
    if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_SLOP) return;
    if (!p.moved) {
      p.moved = true;
      if (mode === 'docked') ctx.update(id, { mode: 'floating' });     // pulled off
    }
    setPos(clamp(e.clientX - p.dx, e.clientY - p.dy));
  };
  const onHeaderPointerUp = () => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    if (p.moved) ctx.update(id, { pos });
    else setExpanded((x) => !x);
  };

  // ── Window controls ──────────────────────────────────────────────────────
  const pullOff = () => {
    const at = pos ? clamp(pos.x + 24, pos.y + 24) : null;
    setPos(at);
    ctx.update(id, { mode: 'floating', pos: at });
  };
  const putBack = () => {
    if (ctx.anchorOf(inspector)) ctx.update(id, { mode: 'docked' });
  };
  const minimize = () => {
    setMaximized(false);
    ctx.update(id, { mode: 'minimized', restoreTo: mode === 'docked' ? 'docked' : 'floating', pos });
  };
  const canPutBack = mode === 'floating' && !!ctx.anchorOf(inspector);

  // ── Whole columns: fetch the rows the grid hasn't loaded ─────────────────
  const [whole, setWhole] = useState<WholeRows | null>(null);
  const loadedCount = loadedRows.length;
  useEffect(() => {
    if (!wholeColumns || !refId) return;
    let live = true;
    (async () => {
      try {
        const meta = await fetchDataMeta(refId);
        if (!live || !(meta.rows > loadedCount)) return;
        const fetched = await fetchDataView(refId, 0, Math.min(meta.rows, WHOLE_CAP)) as Cell[];
        if (!live) return;
        const map: Record<string, Cell> = {};
        for (const c of fetched) map[`${c.row_id}:${c.column_id}`] = c;
        const ids = Array.from(new Set(fetched.map((c) => c.row_id))).sort((a, b) => a - b);
        setWhole({ rows: ids, cells: map, total: meta.rows });
      } catch {
        // Keep the loaded rows.
      }
    })();
    return () => { live = false; };
  }, [wholeColumns, refId, loadedCount]);

  const rows = whole?.rows ?? loadedRows;
  const cells = whole?.cells ?? loadedCells;
  const isSelected = whole ? (_row: number, col: string) => cols.includes(col) : (row: number, col: string) => inGridSel(sel, row, col);
  const shownWhat = whole
    ? `${what.split(' · ')[0]} · ${whole.total > rows.length ? `first ${rows.length} of ${whole.total}` : whole.total} rows`
    : what;

  // One state line. Phase 3 brings core's per-cell states; until then:
  // failed when a selected cell holds an error, else current.
  const selected = rows.flatMap((r) => cols.filter((c) => isSelected(r, c)).map((c) => cells[`${r}:${c}`]));
  const failed = selected.find((c) => isErrorCell(c));
  const state = failed ? `failed · ${failed.display_value}` : selected.every((c) => !c) ? 'empty' : 'current';

  // Only the selected cells (owner, 2026-10-29): the rows and columns that
  // hold one, no index and no column names — the header says what they are.
  const shownRows = rows.filter((r) => cols.some((c) => isSelected(r, c)));
  const shownCols = cols.filter((c) => rows.some((r) => isSelected(r, c)));
  const single = shownRows.length === 1 && shownCols.length === 1 ? cells[`${shownRows[0]}:${shownCols[0]}`] : undefined;
  const imageKeys = shownRows.flatMap((r) => shownCols
    .filter((c) => isSelected(r, c) && cells[`${r}:${c}`]?.cell_type === 'image')
    .map((c) => `${r}:${c}`));
  const drawn = new Set(refId ? imageKeys.slice(0, MAX_IMAGES) : []);

  // ── Size: drag the box's right edge, bottom edge or corner ───────────────
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width?: number; height?: number } | null>(null);
  const startResize = (e: React.PointerEvent, axes: 'x' | 'y' | 'xy') => {
    e.preventDefault();
    e.stopPropagation();
    const el = box.current;
    if (!el) return;
    const from = { x: e.clientX, y: e.clientY, w: el.offsetWidth, h: el.offsetHeight };
    const move = (m: PointerEvent) => setSize((prev) => ({
      width: axes !== 'y' ? Math.max(80, from.w + m.clientX - from.x) : prev?.width,
      height: axes !== 'x' ? Math.max(28, from.h + m.clientY - from.y) : prev?.height,
    }));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const display = !!(single?.cell_type && refId);
  const expression = (formula ?? '').replace(/^=/, '');
  const ink = textOn(color);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return createPortal(
    <div
      ref={ref}
      className={`si-frame si-${mode}${maximized ? ' si-maximized' : ''}${display ? ' si-display' : ''}`}
      style={{
        ...(maximized ? {} : { left: pos?.x ?? -9999, top: pos?.y ?? -9999 }),
        zIndex: inspector.z,
        ['--si-color' as string]: color,
      }}
      role="dialog"
      aria-label={`${stepName} · ${shownWhat}`}
      onMouseDown={(e) => { stop(e); ctx.raise(id); }}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
      onKeyDown={stop}
    >
      <div
        ref={headerRef}
        className={`si-header${expanded ? ' si-expanded' : ''}`}
        style={{ background: color, color: ink }}
        title={expanded ? 'Drag to pull off · click to show less' : 'Drag to pull off · click to show the whole expression'}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
      >
        <div className="si-title">
          <SymbolIcon name="frame_inspect" size={14} />
          <span className="si-step">{stepName}</span>
          <span className="si-what">{shownWhat}</span>
          <span className="si-controls">
            {mode === 'docked'
              ? <HeaderButton icon="open_in_new" label="Pull off" onClick={pullOff} />
              : <HeaderButton icon="open_in_new_down" label="Put back in place" onClick={putBack} disabled={!canPutBack} />}
            <HeaderButton
              icon={maximized ? 'close_fullscreen' : 'open_in_full'}
              label={maximized ? 'Restore' : 'Expand'}
              onClick={() => setMaximized((m) => !m)}
            />
            <HeaderButton icon="minimize" label="Minimize" onClick={minimize} />
            <HeaderButton icon="close" label="Close" onClick={() => ctx.close(id)} />
          </span>
        </div>
        {/* The tools row: widgets that work on the selection inside this frame. */}
        <div className="si-tools" role="toolbar" aria-label="Inspector tools">
          <Tool side="inputs" label="Inputs: what made this (coming with the wiring)" />
          <Tool side="outputs" label="Outputs: what this feeds (coming with the wiring)" />
        </div>
        {expanded && (
          <div className="si-detail">
            {expression && <code className="si-expression">{expression}</code>}
            <div className={`si-state${failed ? ' si-state-failed' : ''}`}>{state}</div>
          </div>
        )}
      </div>
      {/* The selected cells, framed in the step's colour: the frame fills
          whatever size the box is given, so it stays square round them. */}
      <div className="si-body">
        <div
          ref={box}
          className="si-box"
          style={maximized ? undefined : size ? { ...size, maxWidth: 'none', maxHeight: 'none' } : display ? DISPLAY_SIZE : undefined}
        >
          {display ? (
            <CellViewer refId={refId!} row={shownRows[0]} column={shownCols[0]} mode="embedded" onClose={() => ctx.close(id)} />
          ) : shownRows.length <= 1 && shownCols.length <= 1 ? (
            // One cell: its value alone. (No data column: a # cell.)
            <div className={`si-value${isErrorCell(single) ? ' si-error' : ''}`}>
              {shownCols.length === 0 ? rows[0] : single ? single.display_value : ''}
            </div>
          ) : (
            <table className="si-table">
              {imageKeys.length > drawn.size && (
                <caption className="si-note">first {drawn.size} of {imageKeys.length} images shown</caption>
              )}
              <tbody>
                {shownRows.map((r) => (
                  <tr key={r}>
                    {shownCols.map((c) => {
                      const cell = cells[`${r}:${c}`];
                      const inSel = isSelected(r, c);
                      return (
                        <td key={c} className={`${inSel ? '' : 'si-unselected'}${isErrorCell(cell) ? ' si-error' : ''}`}>
                          {inSel && cell
                            ? drawn.has(`${r}:${c}`)
                              ? <InspectImage refId={refId!} row={r} column={c} summary={cell.summary ?? cell.display_value} />
                              : cell.cell_type ? (cell.summary ?? cell.display_value) : cell.display_value
                            : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {!maximized && (
          <>
            <span className="si-resize si-resize-x" aria-hidden="true" onPointerDown={(e) => startResize(e, 'x')} />
            <span className="si-resize si-resize-y" aria-hidden="true" onPointerDown={(e) => startResize(e, 'y')} />
            <span className="si-resize si-resize-xy" aria-hidden="true" onPointerDown={(e) => startResize(e, 'xy')} />
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

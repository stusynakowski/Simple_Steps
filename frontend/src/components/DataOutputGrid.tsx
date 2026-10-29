import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isErrorCell } from '../utils/errorCells';
import { referenceBoxes, selectionText } from '../utils/selection';
import { useStepWiring } from '../context/StepWiringContext';
import type { GridPick } from '../utils/selection';
import {
  INDEX_COL, applyGridPick, cellKey, describeGridSel, drawnIn, inGridSel, selectionEdges, selectionExtent,
  selectionBottomRight, selectionTopLeft, takesWholeColumns,
} from '../utils/gridSelection';
import type { GridSel, GridSelPick } from '../utils/gridSelection';
import type { GridSpot } from '../utils/stepsStatus';
import type { Cell } from '../types/models';
import { InspectorProvider, useInspectors } from '../context/InspectorContext';
import { textOn, withAlpha } from '../utils/contrast';
import SymbolIcon from './SymbolIcon';
import type { SymbolName } from './SymbolIcon';
import './OperationColumn.css'; // Ensure grid styles are available
import './CellViewer.css';

/** The selection's outline when the step has no colour (spec 014 REQ-VIS-012). */
const SELECTION_EDGE = '#1f2937';
/** Height of the selection's header tab, which sits on the box's top edge. */
const TAB_H = 16;

/** The active cell's row number and column header. */
const ACTIVE_HEADER_BG = '#e2e5ea';

/** Where an inspected selection is marked in the grid, against the grid. */
interface Mark { id: number; left: number; top: number; width: number; height: number }

/** A typed cell's icon when it has no thumbnail (Material Symbols, never emoji). */
const TYPE_ICONS: Record<string, SymbolName> = { plotly: 'show_chart', table: 'table_chart', json: 'data_object' };

/**
 * What a cell shows. Text and numbers as they are; a typed value (an image, a
 * figure, a table, a dict — backend cell_types.py) as its preview or an icon,
 * plus its summary. The full value opens in the selection popover.
 */
function CellContent({ cell }: { cell: Cell }) {
  if (!cell.cell_type) return <>{cell.display_value}</>;
  const summary = cell.summary ?? cell.display_value;
  return (
    <span className="typed-cell" data-cell-type={cell.cell_type}>
      {cell.preview
        ? <img className="typed-cell-thumb" src={cell.preview} alt="" />
        : TYPE_ICONS[cell.cell_type] && <span className="typed-cell-icon"><SymbolIcon name={TYPE_ICONS[cell.cell_type]} size={14} /></span>}
      <span className="typed-cell-text">{summary}</span>
    </span>
  );
}

/** The column of the 1×1 frame shown for a step with no output yet — core's
 *  default output column name. */
export const EMPTY_FRAME_COLUMN = 'value';
const EMPTY_FRAME_CELL: Cell = {
  row_id: 0, column_id: EMPTY_FRAME_COLUMN, value: null, display_value: 'empty',
  metadata: { empty: true },
};
const isEmptyFrameCell = (cell?: Cell) => cell?.metadata?.empty === true;

/** A cell's tooltip: its value, and core's state when it isn't plainly known. */
function cellTitle(cell?: Cell): string {
  if (!cell) return '';
  const shown = cell.cell_type ? (cell.summary ?? cell.display_value) : cell.display_value;
  switch (cell.state) {
    case 'pending': return `not run yet${cell.type ? ` · ${cell.type}` : ''}`;
    case 'maybe': return `not run yet; this row may not be kept${cell.type ? ` · ${cell.type}` : ''}`;
    case 'failed': return `failed: ${cell.error ?? 'no reason given'}`;
    case 'stale': return `${shown} · out of date`;
    case 'absent': return 'absent: no value here';
    default: return shown ?? '';
  }
}

interface DataOutputGridProps {
  cells?: Cell[];
  onCellClick?: (cell: Cell) => void;
  wiringMode?: boolean;
  /** In wiring mode: a click on the whole table, a column header or a row number. */
  onPick?: (pick: GridPick) => void;
  /** Visual mode for staged cells when pipeline is queued/running */
  stagedCellMode?: 'idle' | 'scheduled' | 'running';
  /** The output these cells come from; lets a typed cell open its full view. */
  refId?: string;
  /**
   * What the pointer is over — the table corner, a column, a row, a cell — or
   * null when it leaves the grid. In every mode, not just wiring; the steps
   * bar shows it (context/StepsStatusContext).
   */
  onHoverChange?: (spot: GridSpot | null) => void;
  /**
   * The data's size and the selection in one line (`3 rows, 2 columns · row 1`),
   * whenever it changes — shown on the Data bar, not under the grid.
   */
  onNoteChange?: (note: string) => void;
  /** The step's name, colour and formula, for the selection popover's header. */
  stepName?: string;
  stepColor?: string;
  formula?: string;
  /** Core's columns for the step, with their types (its view or plan): a step
   *  that hasn't run shows them as its header (dev_plan/126 R6). */
  columns?: { name: string; type?: string }[];
  /** Why a staged step's rows aren't known yet, from its plan. */
  planNote?: string;
}

/**
 * The grid's selection inspectors live in the app's InspectorProvider; a grid
 * rendered without one (tests, a stand-alone page) brings its own.
 */
export default function DataOutputGrid(props: DataOutputGridProps) {
  const ctx = useInspectors();
  return ctx ? <Grid {...props} /> : <InspectorProvider><Grid {...props} /></InspectorProvider>;
}

function Grid({
  cells = [],
  onCellClick,
  wiringMode = false,
  onPick,
  stagedCellMode = 'idle',
  refId,
  onHoverChange,
  onNoteChange,
  stepName = 'step',
  stepColor,
  formula,
  columns,
  planNote,
}: DataOutputGridProps) {
  const [hoveredCol, setHoveredCol] = useState<string | null>(null);
  // Looking at data (spec 014 §6, §8): a click selects — a cell, a row, a
  // column, the whole table, a block — and draws its outline only. Hovering
  // the selection's header tab opens the selection inspector. Picking for a
  // formula (wiring mode) is separate.
  // The selection remembers the cells it was made on: new data (a re-run, a
  // new page) means the old selection may not exist any more, so it lapses.
  // Open inspectors keep the copy they were opened with.
  const [selection, setSelection] = useState<{ sel: GridSel | null; of: Cell[] | undefined }>({ sel: null, of: cells });
  const inspectorCtx = useInspectors()!;
  const owner = useId();
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  // Cells aren't pickable yet (they need rows AND columns, core 005 K9), so
  // only the setter is used — kept for when they are.
  const [, setHoveredCell] = useState<string | null>(null);

  // Memoize grid structure calculation
  const { cols, rows, gridData, structureType } = useMemo(() => {
    const safeCells = cells ?? [];

    if (safeCells.length === 0 && columns?.length) {
      // Planned but no rows yet (a staged step whose row count isn't known):
      // its typed header, and the plan's reason below it.
      return {
        cols: columns.map((c) => c.name), rows: [] as number[], gridData: {} as Record<string, Cell>,
        structureType: 'grid',
      };
    }

    if (safeCells.length === 0) {
      // A step's Data is always a dataframe. With nothing in it yet — an empty
      // or undefined expression, or a step not run — it is a 1×1 frame whose
      // one cell says "empty", drawn by the same grid as any other output.
      return {
        cols: [EMPTY_FRAME_COLUMN], rows: [0], gridData: { [`0:${EMPTY_FRAME_COLUMN}`]: EMPTY_FRAME_CELL },
        structureType: 'grid',
      };
    }

    const uniqueCols = Array.from(new Set(safeCells.map((c) => c.column_id)));
    const uniqueRows = Array.from(new Set(safeCells.map((c) => c.row_id))).sort(
      (a, b) => a - b
    );

    // Create a lookup map for faster access: "rowId:colId" -> Cell
    const dataMap: Record<string, Cell> = {};
    safeCells.forEach((c) => {
      dataMap[`${c.row_id}:${c.column_id}`] = c;
    });

    // Determine visualization type — always use grid for tabular consistency
    const type = 'grid';

    return {
      cols: uniqueCols,
      rows: uniqueRows,
      gridData: dataMap,
      structureType: type,
    };
  }, [cells, columns]);

  // Core's type for each column, and its row id for each row (dev_plan/126 R5, D8).
  const typeOf = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of columns ?? []) if (c.type) out[c.name] = c.type;
    for (const c of cells ?? []) if (c.type && !(c.column_id in out)) out[c.column_id] = c.type;
    return out;
  }, [cells, columns]);
  const idOf = useMemo(() => {
    const out: Record<number, string | number> = {};
    for (const c of cells ?? []) if (c.id !== undefined && !(c.row_id in out)) out[c.row_id] = c.id;
    return out;
  }, [cells]);

  // ── Looking: selection and the popover ──────────────────────────────────
  const looking = !wiringMode;
  // The selection, bold, in both modes (D6): looking, or picking for a formula.
  const shownSel = selection.of === cells ? selection.sel : null;
  /** While a formula is being written, tell it what the selection reads (D1). */
  const sendPick = (sel: GridSel | null) => {
    if (wiringMode) onPick?.({ text: selectionText(stepName, sel, rows, cols, idOf) });
  };
  const select = (pick: GridSelPick, e: React.MouseEvent) => {
    // The click that ends a drag: the drag already made the selection.
    if (dragEnded.current) { dragEnded.current = false; return; }
    const mods = { extend: e.shiftKey, toggle: e.metaKey || e.ctrlKey };
    const current = selection.of === cells ? selection.sel : null;
    const next = applyGridPick(current, pick, mods, rows, cols);
    setSelection({ sel: next, of: cells });
    sendPick(next);
  };

  // Drag to select, as in Excel (REQ-VIS-011): press on a cell, a row's strip
  // or a column header and drag; the selection grows from where the press
  // started, as Shift-click would. A press without a move stays a click.
  const drag = useRef<{ kind: 'cell' | 'row' | 'column'; start: GridSel | null; moved: boolean } | null>(null);
  const dragEnded = useRef(false);
  const startDrag = (pick: { kind: 'cell'; row: number; col: string } | { kind: 'row'; row: number } | { kind: 'column'; col: string },
    e: React.MouseEvent) => {
    dragEnded.current = false;
    if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey) return;
    e.preventDefault();                       // no text selection while dragging
    drag.current = { kind: pick.kind, start: applyGridPick(null, pick, { extend: false, toggle: false }, rows, cols), moved: false };
    const end = () => {
      if (drag.current?.moved) {
        dragEnded.current = true;
        // The closing click only comes when the drag ends where it began;
        // otherwise don't let the flag swallow the next real click.
        setTimeout(() => { dragEnded.current = false; }, 0);
      }
      drag.current = null;
      window.removeEventListener('mouseup', end);
    };
    window.addEventListener('mouseup', end);
  };
  /** The pointer, mid-drag, is over (row, col) — a header when row is -1. */
  const dragOver = (row: number, col: string) => {
    const d = drag.current;
    if (!d) return;
    const pick: GridSelPick | null =
      d.kind === 'cell' ? (row === -1 ? null : { kind: 'cell', row, col })
        : d.kind === 'row' ? (row === -1 ? null : { kind: 'row', row })
          : col === INDEX_COL ? null : { kind: 'column', col };
    if (!pick) return;
    d.moved = true;
    const next = applyGridPick(d.start, pick, { extend: true, toggle: false }, rows, cols);
    setSelection({ sel: next, of: cells });
    sendPick(next);
  };
  const activeCell = shownSel?.kind === 'cell' ? shownSel.anchor : null;

  // The selection is one bold box round its cells, in the step's colour, as
  // in Excel (REQ-VIS-012). A small header tab on the box's top-left edge
  // names it; clicking the tab opens the selection popover (REQ-VIS-040).
  const edge = stepColor ?? SELECTION_EDGE;

  /** The outline drawn on one cell or header, as inset shadows. */
  const outline = (row: number, col: string): React.CSSProperties => {
    const e = selectionEdges(shownSel, row, col, rows, cols);
    const sides = [
      e.top && `inset 0 2px 0 ${edge}`,
      e.bottom && `inset 0 -2px 0 ${edge}`,
      e.left && `inset 2px 0 0 ${edge}`,
      e.right && `inset -2px 0 0 ${edge}`,
    ].filter(Boolean);
    return sides.length ? { boxShadow: sides.join(', ') } : {};
  };

  // Where the header tab goes: above the box's top-left cell, measured once
  // the grid is drawn (cells carry data-sel-key) and again when it resizes.
  const gridRef = useRef<HTMLDivElement>(null);
  const topLeft = selectionTopLeft(shownSel, rows, cols);
  const topLeftKey = topLeft ? cellKey(topLeft.row, topLeft.col) : null;
  /** The grid's shape, as a value: a new rows/cols array with the same contents isn't a change. */
  const shape = `${rows.length}|${cols.join('\u0001')}`;
  // A box that starts at the header row has nothing above it inside the grid
  // (the Data bar is flush on top), so its tab sits inside the box instead:
  // a small icon at the header row's right end.
  const tabInside = topLeft?.row === -1;
  const topRightCol = tabInside
    ? [INDEX_COL, ...cols].reverse().find((c) => drawnIn(shownSel, -1, c, cols)) ?? null : null;
  const tabKey = tabInside ? (topRightCol === null ? null : cellKey(-1, topRightCol)) : topLeftKey;
  const [tabAt, setTabAt] = useState<{ left: number; top: number } | null>(null);
  // The drag handle — a dot on the box's bottom-right corner, as in Excel.
  // Dragging it resizes the selection from its top-left corner. Only for
  // shapes that grow: a cell or block, rows, columns.
  const handleKind = shownSel?.kind === 'cell' || shownSel?.kind === 'block' ? 'cell'
    : shownSel?.kind === 'rows' ? 'row' : shownSel?.kind === 'columns' ? 'column' : null;
  const bottomRight = handleKind ? selectionBottomRight(shownSel, rows, cols) : null;
  const bottomRightKey = bottomRight ? cellKey(bottomRight.row, bottomRight.col) : null;
  const [handleAt, setHandleAt] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || !tabKey) { setTabAt(null); setHandleAt(null); return; }
    const find = (key: string | null) => (key === null ? undefined
      : Array.from(grid.querySelectorAll<HTMLElement>('[data-sel-key]')).find((c) => c.dataset.selKey === key));
    // Only a real move re-renders: placing runs after every layout change.
    const same = (a: { left: number; top: number } | null, b: { left: number; top: number } | null) =>
      a?.left === b?.left && a?.top === b?.top;
    const place = () => {
      const at = find(tabKey);
      const tab = !at ? null
        : tabInside ? { left: at.offsetLeft + at.offsetWidth - 3, top: at.offsetTop + 3 }
          : { left: at.offsetLeft, top: at.offsetTop - TAB_H };
      setTabAt((prev) => (same(prev, tab) ? prev : tab));
      const br = find(bottomRightKey);
      const dot = br ? { left: br.offsetLeft + br.offsetWidth, top: br.offsetTop + br.offsetHeight } : null;
      setHandleAt((prev) => (same(prev, dot) ? prev : dot));
    };
    place();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(place);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [tabKey, tabInside, bottomRightKey, shape]);

  /** Press on the drag handle: resize from the box's top-left corner. */
  const startHandleDrag = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!topLeft || !handleKind) return;
    const from = handleKind === 'cell' ? { kind: 'cell' as const, row: topLeft.row, col: topLeft.col }
      : handleKind === 'row' ? { kind: 'row' as const, row: topLeft.row }
        : { kind: 'column' as const, col: topLeft.col };
    startDrag(from, e);
  };

  // ── Inspecting: the selection inspector ─────────────────────────────────
  /** The cell or header drawn at (row, col), by its data-sel-key. */
  const elementAt = (row: number, col: string) => {
    const key = cellKey(row, col);
    return Array.from(gridRef.current?.querySelectorAll<HTMLElement>('[data-sel-key]') ?? [])
      .find((c) => c.dataset.selKey === key);
  };
  // Tell the inspectors where a selection of this grid is on screen, so one
  // opened in place stays over it.
  const latest = useRef({ rows, cols });
  latest.current = { rows, cols };
  useEffect(() => inspectorCtx.registerAnchor(owner, (sel) => {
    const tl = selectionTopLeft(sel, latest.current.rows, latest.current.cols);
    const el = tl && gridRef.current?.isConnected ? elementAt(tl.row, tl.col) : undefined;
    return el ? el.getBoundingClientRect() : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [inspectorCtx.registerAnchor, owner]);

  /** Open *sel* in the inspector, in place; the selection is let go. */
  const inspect = (sel: GridSel) => {
    const ext = selectionExtent(sel, rows, cols);
    inspectorCtx.open(owner, {
      stepName, color: edge, formula, refId,
      what: describeGridSel(sel, rows, cols),
      rows: ext.rows, cols: ext.cols, cells: gridData,
      sel, wholeColumns: takesWholeColumns(sel),
    });
    setSelection({ sel: null, of: cells });
  };

  /** The selection's header tab. */
  const openInspector = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (shownSel) inspect(shownSel);
  };

  /**
   * A click on a cell (the index's too) selects it: the box only. The
   * selection's corner control opens the inspector (owner, 2026-10-28, D5).
   */
  const clickCell = (row: number, col: string, e: React.MouseEvent) => {
    select({ kind: 'cell', row, col }, e);
  };

  // While a selection is inspected, it is marked in the grid: a dashed
  // outline and a light shade in the step's colour, and the inspector icon
  // on its corner (a click on it brings the inspector back).
  const inspected = inspectorCtx.inspectors.filter((i) => i.owner === owner);
  const inspectedKey = inspected.map((i) => `${i.id}:${i.sel.cells.join(',')}:${i.sel.headers.join(',')}`).join('|');
  const [marks, setMarks] = useState<Mark[]>([]);
  useLayoutEffect(() => {
    const place = () => {
      const next: Mark[] = [];
      for (const i of inspected) {
        const tl = selectionTopLeft(i.sel, rows, cols);
        const br = selectionBottomRight(i.sel, rows, cols);
        const a = tl && elementAt(tl.row, tl.col);
        const b = br && elementAt(br.row, br.col);
        if (!a || !b) continue;
        next.push({
          id: i.id, left: a.offsetLeft, top: a.offsetTop,
          width: b.offsetLeft + b.offsetWidth - a.offsetLeft, height: b.offsetTop + b.offsetHeight - a.offsetTop,
        });
      }
      setMarks((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    place();
    if (typeof ResizeObserver === 'undefined' || !gridRef.current) return;
    const ro = new ResizeObserver(place);
    ro.observe(gridRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectedKey, shape]);

  // ── References from the formula being written (R3, D6) ──────────────────
  // While a formula bar has focus, each of its references to this step is
  // boxed, dashed, in this step's colour, around the cells it covers: only
  // when this step's output is shown, not while it's staged.
  const { wiringState } = useStepWiring();
  const myRefs = wiringState.references.filter((r) => r.step === stepName);
  const outputShown = (cells ?? []).some((c) => !c.state || ['known', 'failed', 'stale', 'absent'].includes(c.state));
  const refsKey = outputShown ? JSON.stringify(myRefs) : '';
  const [refMarks, setRefMarks] = useState<Omit<Mark, 'id'>[]>([]);
  useLayoutEffect(() => {
    const place = () => {
      const next: Omit<Mark, 'id'>[] = [];
      if (outputShown) {
        for (const ref of myRefs) {
          for (const box of referenceBoxes(ref, rows, cols, idOf)) {
            const a = elementAt(box.rows[0], box.cols[0]);
            const b = elementAt(box.rows[box.rows.length - 1], box.cols[box.cols.length - 1]);
            if (!a || !b) continue;
            next.push({ left: a.offsetLeft, top: a.offsetTop,
              width: b.offsetLeft + b.offsetWidth - a.offsetLeft, height: b.offsetTop + b.offsetHeight - a.offsetTop });
          }
        }
      }
      setRefMarks((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    place();
    if (typeof ResizeObserver === 'undefined' || !gridRef.current) return;
    const ro = new ResizeObserver(place);
    ro.observe(gridRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsKey, shape]);

  // ── Picks for a formula ─────────────────────────────────────────────────
  // While a later step's formula bar has focus, the same selection as looking
  // (a cell, a block, rows, columns, the # corner; Shift, ⌘/Ctrl, drag) is
  // sent to it in core's notation (sendPick, utils/selection.ts).

  const handleRowClick = (rowIndex: number, e: React.MouseEvent) => {
    select({ kind: 'row', row: rowIndex }, e);
  };

  const handleColumnClick = (col: string, e: React.MouseEvent) => {
    select({ kind: 'column', col }, e);
    if (!wiringMode) onCellClick?.({ row_id: -1, column_id: col, value: col, display_value: col } as Cell);
  };

  const handleCellWireClick = (cell: Cell, e: React.MouseEvent) => {
    clickCell(cell.row_id, cell.column_id, e);
    if (!wiringMode) onCellClick?.(cell);
  };

  const handleCornerClick = (e: React.MouseEvent) => {
    select({ kind: 'all' }, e);
  };

  // The index column: its header selects it, its
  // cells select like any cell. Looking only — a formula can't reference the
  // index yet.
  const handleIndexClick = (e: React.MouseEvent) => {
    if (!wiringMode) select({ kind: 'index' }, e);
  };
  const handleIndexCellClick = (row: number, e: React.MouseEvent) => {
    if (!wiringMode) clickCell(row, INDEX_COL, e);
  };


  const note = `${rows.length} row${rows.length !== 1 ? 's' : ''}, ${cols.length} column${cols.length !== 1 ? 's' : ''}`
    + (shownSel ? ` · ${describeGridSel(shownSel, rows, cols)}` : '');
  useEffect(() => { onNoteChange?.(note); }, [note, onNoteChange]);

  // ── Wiring overlay styles ───────────────────────────────────────────────

  const HOVER_BG = 'rgba(255, 193, 7, 0.16)';

  const wiringColHeaderStyle = (col: string): React.CSSProperties => {
    if (!wiringMode) return { cursor: 'pointer', userSelect: 'none' as const };
    return {
      cursor: 'crosshair',
      userSelect: 'none',
      background: hoveredCol === col ? HOVER_BG : undefined,
      transition: 'background 0.1s ease',
    };
  };

  const wiringCellStyle = (key: string, col: string): React.CSSProperties => {
    const row = Number(key.split(':')[0]);
    if (!wiringMode) return { cursor: 'pointer' };
    const hovered = hoveredCol === col || hoveredRow === row || hoveredCol === '__table__';
    return {
      cursor: 'cell',
      // Hover shading only: a cell keeps its state's colour (pending, failed, …).
      background: hovered ? HOVER_BG : undefined,
      transition: 'background 0.1s ease',
    };
  };

  // ── SCENARIO 0: the step failed — its output is one error cell ─────────
  // `errorCell()` (utils/errorCells.ts) builds it when a run or preview fails,
  // including an expression that doesn't parse.
  if (cells && cells.length === 1 && isErrorCell(cells[0])) {
    return (
      <div className="output-container error">
        <div className="error-cell" role="alert" data-testid="step-error-cell">
          {cells[0].display_value}
        </div>
      </div>
    );
  }

  // ── SCENARIO 1: Single Value (Hero Cell) ───────────────────────────────

  if (structureType === 'single-value') {
    const cell = gridData[`${rows[0]}:${cols[0]}`];
    return (
      <div className="output-container single">
        <div
          className="single-value-display"
          onClick={(e) => {
            if (cell) handleCellWireClick(cell, e);
          }}
          title="Click to select"
          style={{}}
        >
          {cell ? <CellContent cell={cell} /> : ''}
        </div>
      </div>
    );
  }

  // ── SCENARIO 2 & 3: List or Grid ──────────────────────────────────────

  return (
    <div className="output-container grid-wrapper">
      {/* Wiring mode banner */}

      <div
        className={`op-data-grid${wiringMode ? ' wiring-source' : ''}`}
        ref={gridRef}
        onMouseLeave={() => onHoverChange?.(null)}
        style={{
          // The # column fits its widest row id, and no wider (owner, 2026-10-28).
          gridTemplateColumns: `var(--grid-gutter) max-content repeat(${cols.length}, minmax(100px, 1fr))`,
          ...(wiringMode
            ? {
                outline: '1px solid rgba(255, 193, 7, 0.6)',
                outlineOffset: -1,
                borderRadius: 3,
              }
            : {}),
        }}
        role="grid"
      >
        {/* Header row. Left of it, the top of the row margin: selects the
            whole table. Then the index column's header, then the columns'.
            Rows are selected from the margin left of them, so every cell —
            the index's included — stays a cell of its own. */}
        <div
          className={`grid-gutter grid-gutter-left grid-gutter-corner${shownSel?.kind === 'all' ? ' is-selected' : ''}`}
          role="button"
          aria-label="Select the whole table"
          title="Select the whole table"
          style={wiringMode ? { cursor: 'crosshair' } : undefined}
          onClick={handleCornerClick}
          onMouseEnter={() => { setHoveredCol('__table__'); onHoverChange?.({ kind: 'table' }); }}
          onMouseLeave={() => setHoveredCol(null)}
        />
        <div
          className="grid-header-cell row-index-header"
          data-sel-key={cellKey(-1, INDEX_COL)}
          title={wiringMode ? "The row ids (#) can't be referenced yet" : '# row ids (Shift: range, ⌘/Ctrl: add)'}
          style={{ cursor: wiringMode ? 'default' : 'pointer', ...outline(-1, INDEX_COL) }}
          onClick={handleIndexClick}
          onMouseEnter={() => { onHoverChange?.({ kind: 'column', column: '#' }); }}
        >
          #
        </div>
        {cols.map((col) => (
          <div
            key={col}
            className="grid-header-cell"
            data-sel-key={cellKey(-1, col)}
            role="columnheader"
            title={wiringMode ? `Select column ${col} (Shift: range, ⌘/Ctrl: add)` : typeOf[col] ? `${col}: ${typeOf[col]}` : col}
            style={{
              ...wiringColHeaderStyle(col),
              ...(activeCell?.col === col ? { background: ACTIVE_HEADER_BG } : {}),
              ...outline(-1, col),
            }}
            onMouseDown={(e) => startDrag({ kind: 'column', col }, e)}
            onClick={(e) => handleColumnClick(col, e)}
            onMouseEnter={() => { if (wiringMode) setHoveredCol(col); dragOver(-1, col); onHoverChange?.({ kind: 'column', column: col }); }}
            onMouseLeave={() => wiringMode && setHoveredCol(null)}
          >
            {col}
            {typeOf[col] && <span className="col-type">{typeOf[col]}</span>}
          </div>
        ))}

        {shownSel && tabAt && !wiringMode && (
          <button
            type="button"
            className={`sel-tab${tabInside ? ' sel-tab-inside' : ''}`}
            style={{ left: tabAt.left, top: tabAt.top, height: TAB_H, background: edge, color: textOn(edge) }}
            aria-label="Open the selection"
            title={`Inspect ${describeGridSel(shownSel, rows, cols)}: its expression, state, inputs and outputs`}
            onClick={openInspector}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <SymbolIcon name="frame_inspect" size={12} />
            {!tabInside && describeGridSel(shownSel, rows, cols)}
          </button>
        )}
        {refMarks.map((m, i) => (
          <div key={`ref-${i}`} className="reference-mark" aria-hidden="true"
            style={{ left: m.left, top: m.top, width: m.width, height: m.height, borderColor: edge }} />
        ))}
        {marks.map((m) => (
          <div
            key={m.id}
            className="inspected-mark"
            style={{ left: m.left, top: m.top, width: m.width, height: m.height, borderColor: edge, background: withAlpha(edge, 0.08) }}
          >
            <button
              type="button"
              className="inspected-mark-icon"
              style={{ color: edge }}
              aria-label="Show its inspector"
              title="Being inspected · show its inspector"
              onClick={(e) => {
                e.stopPropagation();
                const i = inspected.find((x) => x.id === m.id);
                if (i?.mode === 'minimized') inspectorCtx.restore(m.id);
                else inspectorCtx.raise(m.id);
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <SymbolIcon name="frame_inspect" size={13} />
            </button>
          </div>
        ))}
        {shownSel && handleAt && (
          <span
            className="sel-handle"
            style={{ left: handleAt.left, top: handleAt.top, background: edge }}
            aria-hidden="true"
            title="Drag to resize the selection"
            onMouseDown={startHandleDrag}
          />
        )}

        {/* Data Rows */}
        {rows.map((r) => (
          <div key={r} className="grid-row" role="row">
            {/* The margin left of the row: selects the whole row. */}
            <div
              className={`grid-gutter grid-gutter-left${shownSel?.kind === 'rows' && inGridSel(shownSel, r, cols[0]) ? ' is-selected' : ''}`}
              title={`Select row ${r} (Shift: range, ⌘/Ctrl: add)`}
              style={wiringMode ? { cursor: 'crosshair' } : undefined}
              onMouseDown={(e) => startDrag({ kind: 'row', row: r }, e)}
              onClick={(e) => handleRowClick(r, e)}
              onMouseEnter={() => { if (wiringMode) setHoveredRow(r); dragOver(r, cols[0]); onHoverChange?.({ kind: 'row', row: r }); }}
              onMouseLeave={() => wiringMode && setHoveredRow(null)}
            />
            {/* The index: a cell of its own. */}
            <div
              className="grid-cell row-index"
              data-sel-key={cellKey(r, INDEX_COL)}
              role="rowheader"
              title={wiringMode ? "The row ids (#) can't be referenced yet" : `# ${idOf[r] ?? r}`}
              style={wiringMode ? {
                cursor: 'default',
                background: hoveredRow === r ? HOVER_BG : undefined,
                transition: 'background 0.1s ease',
              } : {
                cursor: 'pointer',
                ...(activeCell?.row === r ? { background: ACTIVE_HEADER_BG, color: '#222' } : {}),
                ...outline(r, INDEX_COL),
              }}
              onMouseDown={(e) => startDrag({ kind: 'cell', row: r, col: INDEX_COL }, e)}
              onClick={(e) => handleIndexCellClick(r, e)}
              onMouseEnter={() => { dragOver(r, INDEX_COL); onHoverChange?.({ kind: 'cell', row: r, column: '#', value: String(idOf[r] ?? r) }); }}
            >
              {idOf[r] ?? r}
            </div>

            {/* Cells */}
            {cols.map((c) => {
              const cell = gridData[`${r}:${c}`];
              const cellKey = `${r}:${c}`;

              return (
                <div
                  key={cellKey}
                  className={`grid-cell ${cell ? 'has-value' : 'empty'}${isErrorCell(cell) ? ' error-cell' : ''}${isEmptyFrameCell(cell) ? ' empty-frame-cell' : ''}${cell?.state ? ` cell-${cell.state}` : ''}`}
                  data-state={cell?.state}
                  role="gridcell"
                  data-sel-key={cellKey}
                  aria-selected={looking ? inGridSel(shownSel, r, c) : undefined}
                  onMouseDown={(e) => startDrag({ kind: 'cell', row: r, col: c }, e)}
                  onClick={(e) => {
                    if (cell) handleCellWireClick(cell, e);
                    else if (looking) clickCell(r, c, e);
                  }}
                  title={cellTitle(cell)}
                  style={{ ...wiringCellStyle(cellKey, c), ...outline(r, c) }}
                  onMouseEnter={() => {
                    if (wiringMode) {
                      setHoveredCell(cellKey);
                      setHoveredCol(c);
                    }
                    dragOver(r, c);
                    onHoverChange?.({ kind: 'cell', row: r, column: c, value: cell?.display_value });
                  }}
                  onMouseLeave={() => {
                    if (wiringMode) {
                      setHoveredCell(null);
                      setHoveredCol(null);
                    }
                  }}
                >
                  {cell?.state === 'pending' || cell?.state === 'maybe'
                    ? (stagedCellMode !== 'idle'
                      ? <span className="cell-wait-spinner" />
                      : <span className="cell-staged-type">{`<${cell.type ?? 'any'}>`}</span>)
                    : cell?.state === 'known' && cell.value === null && !cell.cell_type
                      ? <span className="cell-null">null</span>
                      : cell ? <CellContent cell={cell} /> : ''}
                </div>
              );
            })}
          </div>
        ))}
        {(cells ?? []).length === 0 && planNote && (
          <div className="grid-plan-note" role="note">rows not known yet: {planNote}</div>
        )}
      </div>
    </div>
  );
}

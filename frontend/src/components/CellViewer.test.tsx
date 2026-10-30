/**
 * TEST: typed cells and the cell viewer (docs/dev_plan/122 §4). A cell richer
 * than text shows its preview or summary in the grid; clicking it opens the
 * full view, fetched separately; wiring mode never opens it.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Cell } from '../types/models';
import type { CellView } from '../services/api';
import DataOutputGrid from './DataOutputGrid';
import CellViewer from './CellViewer';
import CellPanelHost from './CellPanelHost';
import { closeCellPanel } from '../services/cellPanels';

const views: Record<string, CellView> = {
  img: { cell_type: 'image', summary: '16×16 RGB image',
         view: { kind: 'image', src: 'data:image/png;base64,AAAA', width: 16, height: 16 } },
  chart: { cell_type: 'plotly', summary: 'bar chart · 1 trace',
           view: { kind: 'plotly', figure: { data: [{ type: 'bar', x: ['a'], y: [1] }], layout: {} } } },
  tbl: { cell_type: 'table', summary: 'table 2×2',
         view: { kind: 'table', columns: ['a', 'b'], rows: [[1, 'x'], [2, 'y']], total: 2 } },
  obj: { cell_type: 'json', summary: '{2 keys}',
         view: { kind: 'json', value: { city: 'SF', tags: ['a', 'b'] } } },
};

const fetchCellView = vi.fn(async (_ref: string, _row: number, column: string) => views[column]);
vi.mock('../services/api', () => ({
  fetchCellView: (ref: string, row: number, column: string) => fetchCellView(ref, row, column),
}));

const newPlot = vi.fn(async () => {});
vi.mock('plotly.js-dist-min', () => ({ default: { newPlot, purge: vi.fn() } }));

const cells: Cell[] = [
  { row_id: 0, column_id: 'city', value: 'SF', display_value: 'SF' },
  { row_id: 0, column_id: 'img', value: null, display_value: '16×16 RGB image',
    cell_type: 'image', summary: '16×16 RGB image', preview: 'data:image/png;base64,THUMB' },
  { row_id: 1, column_id: 'city', value: 'LA', display_value: 'LA' },
  { row_id: 1, column_id: 'img', value: null, display_value: '16×16 RGB image',
    cell_type: 'image', summary: '16×16 RGB image', preview: 'data:image/png;base64,THUMB' },
];

describe('typed cells in the grid', () => {
  beforeEach(() => fetchCellView.mockClear());

  it('shows an image as its icon and summary, never the image, and plain cells as before', () => {
    // An image is drawn only when it's inspected (owner, 2026-10-30), even
    // when the cell carries a thumbnail.
    const { container } = render(<DataOutputGrid cells={cells} refId="ref1" />);
    expect(screen.getByText('SF')).toBeInTheDocument();
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.querySelectorAll('[data-cell-type="image"] .typed-cell-icon')).toHaveLength(2);
    expect(screen.getAllByText('16×16 RGB image')).toHaveLength(2);
  });

  it('a click selects the cell; its corner opens it in place, fetching that one cell, in the inspector', async () => {
    // Spec 014 §8: the inspector wraps the cell's full view (REQ-VIS-040/041).
    // A click only draws the selection's box; the corner control opens the
    // inspector (owner, 2026-10-28, dev_plan/126 D5; replaces click-to-open, 2026-10-22).
    render(<DataOutputGrid cells={cells} refId="ref1" stepName="pics" />);
    const cell = screen.getAllByText('16×16 RGB image')[1];
    fireEvent.click(cell);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchCellView).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Open the selection'));
    await waitFor(() => expect(fetchCellView).toHaveBeenCalledWith('ref1', 1, 'img'));
    const popover = screen.getByRole('dialog', { name: 'pics · row 1, img' });
    // The cell view sits inside the popover, without controls of its own.
    expect(popover.querySelector('.cv-panel.cv-embedded')).not.toBeNull();
    expect(popover.querySelectorAll('[aria-label="Close"]')).toHaveLength(1);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('never opens the viewer while picking data for a formula', () => {
    render(<DataOutputGrid cells={cells} refId="ref1" wiringMode />);
    fireEvent.click(screen.getAllByText('16×16 RGB image')[0]);
    expect(fetchCellView).not.toHaveBeenCalled();
    expect(screen.queryByRole('region')).toBeNull();
  });
});

describe('CellViewer', () => {
  const open = (column: string) =>
    render(<CellViewer refId="r" row={0} column={column} onClose={() => {}} />);

  it('shows an image at full size', async () => {
    open('img');
    // The viewer is portalled to <body>, outside the render container.
    await waitFor(() => expect(document.querySelector('img.cv-image')).not.toBeNull());
    expect(document.querySelector('img.cv-image')!.getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });

  it('draws a Plotly figure with plotly.js, loaded only when needed', async () => {
    open('chart');
    await waitFor(() => expect(newPlot).toHaveBeenCalled());
    const [, data] = newPlot.mock.calls[0] as unknown as [HTMLElement, unknown[]];
    expect(data).toEqual([{ type: 'bar', x: ['a'], y: [1] }]);
  });

  it('shows a table in a cell as a table', async () => {
    open('tbl');
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByText('y')).toBeInTheDocument();
  });

  it('shows a dict as a collapsible tree', async () => {
    open('obj');
    expect(await screen.findByText('"SF"')).toBeInTheDocument();
    expect(screen.getByText('[2 items]')).toBeInTheDocument();
  });
});

describe('cell window controls', () => {
  // The panel store is app-wide; start every test with none open.
  afterEach(() => { for (const id of ['r:0:chart', 'r:0:img']) act(() => closeCellPanel(id)); });

  const openInline = (onClose = vi.fn()) => {
    const utils = render(<><CellViewer refId="r" row={0} column="chart" onClose={onClose} /><CellPanelHost /></>);
    return { ...utils, onClose };
  };

  it('minimizes to its title bar in place, and restores', () => {
    const { container } = openInline();
    fireEvent.click(screen.getByLabelText('Minimize'));
    const panel = container.querySelector('.cv-inline')!;
    expect(panel.classList.contains('cv-minimized')).toBe(true);
    expect(panel.querySelector('.cv-body')!.hasAttribute('hidden')).toBe(true);
    fireEvent.click(screen.getByLabelText('Restore'));
    expect(panel.classList.contains('cv-minimized')).toBe(false);
  });

  it('expands over the whole window; Esc puts it back in the grid', () => {
    const { container } = openInline();
    fireEvent.click(screen.getByLabelText('Expand'));
    expect(document.querySelector('.cv-backdrop .cv-inline.cv-maximized')).not.toBeNull();
    expect(container.querySelector('.cv-inline')).toBeNull();     // lifted out of the grid
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.cv-maximized')).toBeNull();
    expect(container.querySelector('.cv-inline.cv-normal')).not.toBeNull();
  });

  it('pulls off into its own panel and leaves the grid', () => {
    const { onClose } = openInline();
    fireEvent.click(screen.getByLabelText('Pull off'));
    expect(onClose).toHaveBeenCalled();
    const panel = document.querySelector('.cv-panel.cv-floating');
    expect(panel).not.toBeNull();
    // A panel has no backdrop, so the app behind it stays usable.
    expect(panel!.closest('.cv-backdrop')).toBeNull();
  });

  it('a pulled-off panel minimizes and restores, ignores Esc, and closes with ×', () => {
    openInline();
    fireEvent.click(screen.getByLabelText('Pull off'));
    const panel = () => document.querySelector('.cv-floating');
    fireEvent.click(panel()!.querySelector('[aria-label="Minimize"]')!);
    expect(panel()!.classList.contains('cv-minimized')).toBe(true);
    fireEvent.click(panel()!.querySelector('[aria-label="Restore"]')!);
    expect(panel()!.classList.contains('cv-minimized')).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(panel()).not.toBeNull();
    fireEvent.click(panel()!.querySelector('[aria-label="Close"]')!);
    expect(panel()).toBeNull();
  });

  it('pulling the same cell off twice is one panel', () => {
    openInline();
    fireEvent.click(screen.getByLabelText('Pull off'));
    render(<CellViewer refId="r" row={0} column="chart" onClose={() => {}} />);
    fireEvent.click(screen.getAllByLabelText('Pull off')[0]);
    expect(document.querySelectorAll('.cv-floating')).toHaveLength(1);
  });
});

import { useEffect, useRef, useState } from 'react';
import { fetchCellView, type CellView } from '../services/api';
import './CellViewer.css';

/**
 * The full view of one cell (docs/dev_plan/122 §4): the image at full size,
 * the interactive Plotly figure, the whole table or dict. The grid shows only
 * a summary and a small preview; this fetches the rest when a cell is opened,
 * so a column of images never loads every full image.
 */

interface CellViewerProps {
  refId: string;
  row: number;
  column: string;
  onClose: () => void;
}

export default function CellViewer({ refId, row, column, onClose }: CellViewerProps) {
  const [data, setData] = useState<CellView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchCellView(refId, row, column)
      .then((v) => { if (live) setData(v); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [refId, row, column]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="cv-backdrop" onMouseDown={onClose} role="dialog" aria-label={`Cell ${column}, row ${row}`}>
      <div className="cv-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cv-header">
          <span className="cv-title">{column} · row {row}</span>
          {data?.summary && <span className="cv-summary">{data.summary}</span>}
          <button className="cv-close" onClick={onClose} title="Close (Esc)">×</button>
        </div>
        <div className="cv-body">
          {error && <div className="cv-error">{error}</div>}
          {!error && !data && <div className="cv-loading">Loading…</div>}
          {data && <ViewBody view={data.view} />}
        </div>
      </div>
    </div>
  );
}

function ViewBody({ view }: { view: CellView['view'] }) {
  switch (view.kind) {
    case 'image':
      return <img className="cv-image" src={view.src} width={view.width} height={view.height} alt="" />;
    case 'plotly':
      return <PlotlyView figure={view.figure} />;
    case 'table':
      return (
        <div className="cv-table-wrap">
          <table className="cv-table">
            <thead><tr>{view.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {view.rows.map((r, i) => (
                <tr key={i}>{r.map((v, j) => <td key={j}>{formatScalar(v)}</td>)}</tr>
              ))}
            </tbody>
          </table>
          {view.total > view.rows.length && (
            <div className="cv-note">Showing {view.rows.length} of {view.total} rows.</div>
          )}
        </div>
      );
    case 'json':
      return <div className="cv-json"><JsonNode value={view.value} open /></div>;
    default:
      return <pre className="cv-text">{view.text}</pre>;
  }
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/** A collapsible tree for dicts and lists. */
function JsonNode({ value, label, open = false }: { value: unknown; label?: string; open?: boolean }) {
  const isArray = Array.isArray(value);
  if (value === null || typeof value !== 'object') {
    return (
      <div className="cv-json-leaf">
        {label !== undefined && <span className="cv-json-key">{label}: </span>}
        <span className={`cv-json-${value === null ? 'null' : typeof value}`}>
          {typeof value === 'string' ? JSON.stringify(value) : String(value)}
        </span>
      </div>
    );
  }
  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  return (
    <details className="cv-json-node" open={open}>
      <summary>
        {label !== undefined && <span className="cv-json-key">{label}: </span>}
        {isArray ? `[${entries.length} items]` : `{${entries.length} keys}`}
      </summary>
      {entries.map(([k, v]) => <JsonNode key={k} label={k} value={v} />)}
    </details>
  );
}

/** Plotly is loaded only when a chart is opened: it is a separate bundle chunk. */
function PlotlyView({ figure }: { figure: { data?: unknown[]; layout?: Record<string, unknown> } }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const el = ref.current;
    import('plotly.js-dist-min')
      .then((mod) => {
        if (cancelled || !el) return;
        const Plotly = (mod as { default?: PlotlyLike }).default ?? (mod as unknown as PlotlyLike);
        return Plotly.newPlot(el, figure.data ?? [], { autosize: true, ...(figure.layout ?? {}) },
          { responsive: true, displaylogo: false });
      })
      .catch((e) => { if (!cancelled) setFailed(e instanceof Error ? e.message : String(e)); });
    return () => {
      cancelled = true;
      import('plotly.js-dist-min').then((mod) => {
        const Plotly = (mod as { default?: PlotlyLike }).default ?? (mod as unknown as PlotlyLike);
        if (el) Plotly.purge(el);
      }).catch(() => {});
    };
  }, [figure]);

  if (failed) return <div className="cv-error">Couldn't draw the chart: {failed}</div>;
  return <div className="cv-plotly" ref={ref} />;
}

interface PlotlyLike {
  newPlot: (el: HTMLElement, data: unknown[], layout: unknown, config: unknown) => Promise<unknown>;
  purge: (el: HTMLElement) => void;
}

import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Step, StepStatus } from '../types/models';

/**
 * The workflow toolbar's Overview menu: the workflow at a glance — how many
 * steps it has, where each one stands, and how many resources it declares.
 */

interface WorkflowOverviewProps {
  name: string;
  steps: Step[];
  /** The resource column's state (spec 017 REQ-RES-019). */
  resources: { total: number; loaded: number; attention: number };
}

const STATUS_LABEL: Record<StepStatus, string> = {
  pending: 'Queued', running: 'Running', completed: 'Completed',
  error: 'Error', paused: 'Paused', stopped: 'Stopped',
};

export default function WorkflowOverview({ name, steps, resources }: WorkflowOverviewProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const counts = steps.reduce<Partial<Record<StepStatus, number>>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="ut-group" ref={rootRef}>
      <button
        className={`ut-dropdown-trigger ${open ? 'active' : ''}`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor({ top: r.bottom + 6, left: r.left });
          setOpen((v) => !v);
        }}
        title="This workflow at a glance"
      >
        <span>Overview</span>
        <span className="ut-badge">{steps.length}</span>
        <span className="ut-caret">▾</span>
      </button>

      {/* Portalled out of the header, which clips overflow (as ResourcesMenu). */}
      {open && createPortal(
        <div
          ref={panelRef}
          className="ut-dropdown-panel ut-overview-panel"
          style={{
            position: 'fixed', top: anchor.top, left: anchor.left,
            maxHeight: `calc(100vh - ${anchor.top + 16}px)`, overflowY: 'auto',
          }}
        >
          <div className="ut-panel-title">{name}</div>

          <dl className="ut-session-fields">
            <dt>Steps</dt><dd>{steps.length}</dd>
            <dt>Resources</dt>
            <dd>
              {resources.total}
              {resources.total > 0 && ` · ${resources.loaded} loaded`}
              {resources.attention > 0 && ` · ${resources.attention} need${resources.attention === 1 ? 's' : ''} attention`}
            </dd>
            {(Object.keys(STATUS_LABEL) as StepStatus[])
              .filter((s) => counts[s])
              .map((s) => (
                <Fragment key={s}>
                  <dt>{STATUS_LABEL[s]}</dt><dd>{counts[s]}</dd>
                </Fragment>
              ))}
          </dl>

          {steps.length === 0 ? (
            <div className="ut-empty">No steps yet</div>
          ) : (
            <div className="ut-resource-list">
              {steps.map((s, i) => (
                <div key={s.id} className="ut-resource-row">
                  <span className={`ut-overview-dot ut-overview-dot--${s.status}`} />
                  <span className="ut-resource-name">{i + 1}. {s.label}</span>
                  <span className="ut-resource-meta">{STATUS_LABEL[s.status] ?? s.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

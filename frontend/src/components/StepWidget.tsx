import type { ReactNode } from 'react';
import { PANEL_META, PANEL_ORDER } from './stepPanels';
import type { PanelId } from './stepPanels';

interface Props {
  id: PanelId;
  collapsed: boolean;
  onToggleCollapse: (id: PanelId) => void;
  /** Background of the body, so each widget keeps its own look. */
  background: string;
  /** Cap on the body's height; it scrolls past this. */
  maxHeight: string;
  /** A short note at the bar's right end (the data's size and selection). */
  note?: ReactNode;
  /** No name bar: the body alone, always shown — for a panel whose own button
   *  already opens and closes it (the Formula panel and f(x)). */
  bare?: boolean;
  children: ReactNode;
}

/** One widget: a thin name bar that collapses / expands the body below it. */
export default function StepWidget({ id, collapsed, onToggleCollapse, background, maxHeight, note, bare, children }: Props) {
  const { name, accent } = PANEL_META[id];
  if (bare) {
    return (
      <section
        className={`step-widget step-widget--${id} step-widget--bare`}
        data-testid={`step-widget-${id}`}
        style={{ order: PANEL_ORDER.indexOf(id) }}
      >
        <div className="step-widget-body" style={{ background, maxHeight, overflowY: 'auto' }}>
          {children}
        </div>
      </section>
    );
  }
  return (
    <section
      className={`step-widget step-widget--${id}`}
      data-testid={`step-widget-${id}`}
      style={{ order: PANEL_ORDER.indexOf(id) }}
    >
      <button
        type="button"
        className="step-widget-header"
        style={{ borderLeftColor: accent }}
        aria-expanded={!collapsed}
        title={collapsed ? `Expand ${name}` : `Collapse ${name}`}
        onClick={(e) => { e.stopPropagation(); onToggleCollapse(id); }}
      >
        <span className="step-widget-chevron">{collapsed ? '▸' : '▾'}</span>
        <span className="step-widget-name">{name}</span>
        {note && <span className="step-widget-note">{note}</span>}
      </button>
      {!collapsed && (
        <div className="step-widget-body" style={{ background, maxHeight, overflowY: 'auto' }}>
          {children}
        </div>
      )}
    </section>
  );
}

import type { ReactNode } from 'react';
import { PANEL_META } from './stepPanels';
import type { PanelId } from './stepPanels';

interface Props {
  id: PanelId;
  collapsed: boolean;
  onToggleCollapse: (id: PanelId) => void;
  /** Background of the body, so each widget keeps its own look. */
  background: string;
  /** Cap on the body's height; it scrolls past this. */
  maxHeight: string;
  children: ReactNode;
}

/** One widget: a thin name bar that collapses / expands the body below it. */
export default function StepWidget({ id, collapsed, onToggleCollapse, background, maxHeight, children }: Props) {
  const { name, accent } = PANEL_META[id];
  return (
    <section className={`step-widget step-widget--${id}`} data-testid={`step-widget-${id}`}>
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
      </button>
      {!collapsed && (
        <div className="step-widget-body" style={{ background, maxHeight, overflowY: 'auto' }}>
          {children}
        </div>
      )}
    </section>
  );
}

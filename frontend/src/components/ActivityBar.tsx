import React from 'react';
import Icon from './Icon';
import SymbolIcon from './SymbolIcon';
import './ActivityBar.css';

export type ActivityView = 'explorer' | 'environment' | 'docs' | 'settings' | null;

interface ActivityBarProps {
  activeView: ActivityView;
  onViewChange: (view: ActivityView) => void;
  /** Whether the sidebar is open; its chevron, at the very top, folds or opens it. */
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

// Map activity view → codicon name. Centralised so adding a new panel
// (e.g. run-history in Phase E) is a one-line change here.
const ACTIVITY_ICONS: Record<Exclude<ActivityView, null>, string> = {
  explorer: 'files',
  environment: 'server-environment',
  docs: 'book',
  settings: 'settings-gear',
};

const ICON_SIZE = 24;

interface ItemProps {
  view: Exclude<ActivityView, null>;
  active: boolean;
  label: string;
  onClick: (view: ActivityView) => void;
}

const ActivityItem: React.FC<ItemProps> = ({ view, active, label, onClick }) => (
  <div
    className={`activity-item ${active ? 'active' : ''}`}
    onClick={() => onClick(view)}
    title={label}
    role="button"
    tabIndex={0}
  >
    <Icon name={ACTIVITY_ICONS[view]} size={ICON_SIZE} title={label} />
  </div>
);

const ActivityBar: React.FC<ActivityBarProps> = ({ activeView, onViewChange, sidebarOpen = true, onToggleSidebar }) => {
  // Folded, no panel is lit: any icon opens the sidebar to it.
  const lit = sidebarOpen ? activeView : null;
  return (
    <div className={`activity-bar${sidebarOpen ? '' : ' folded'}`}>
      <div className="activity-bar-top">
        {/* The sidebar's fold, at the very top, as the resources' rail has
            (owner, 2026-11-25). */}
        {onToggleSidebar && (
          <button
            type="button"
            className="activity-chevron"
            onClick={onToggleSidebar}
            aria-expanded={sidebarOpen}
            title={sidebarOpen ? 'Hide the sidebar' : 'Show the sidebar'}
            aria-label={sidebarOpen ? 'Hide the sidebar' : 'Show the sidebar'}
          >
            <SymbolIcon name={sidebarOpen ? 'chevron_left' : 'chevron_right'} size={18} />
          </button>
        )}
        <ActivityItem view="explorer" active={lit === 'explorer'} label="Explorer" onClick={onViewChange} />
        <ActivityItem view="environment" active={lit === 'environment'} label="Environment — tools & resources" onClick={onViewChange} />
        <ActivityItem view="docs" active={lit === 'docs'}     label="User Docs" onClick={onViewChange} />
      </div>

      <div className="activity-bar-bottom">
        <ActivityItem view="settings" active={lit === 'settings'} label="Settings" onClick={onViewChange} />
      </div>
    </div>
  );
};

export default ActivityBar;

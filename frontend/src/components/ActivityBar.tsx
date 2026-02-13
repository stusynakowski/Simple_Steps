import React from 'react';
import './ActivityBar.css';

export type ActivityView = 'explorer' | 'search' | 'components' | 'settings' | 'account' | null;

interface ActivityBarProps {
  activeView: ActivityView;
  onViewChange: (view: ActivityView) => void;
}

const ActivityBar: React.FC<ActivityBarProps> = ({ activeView, onViewChange }) => {

  const handleItemClick = (view: ActivityView) => {
    // If clicking the already active view, maybe we want to collapse the sidebar? 
    // For now, let's just set it. Logic for interactions can be in MainLayout.
    onViewChange(view); 
  };

  // Icons (Simple SVGs for now)
  const ExplorerIcon = () => (
    <svg className="activity-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
    </svg>
  );

  const SearchIcon = () => (
    <svg className="activity-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    </svg>
  );

  const ComponentsIcon = () => (
    <svg className="activity-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
    </svg>
  );

  const SettingsIcon = () => (
    <svg className="activity-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
    </svg>
  );
  
  const UserIcon = () => (
      <svg className="activity-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
      </svg>
  );

  return (
    <div className="activity-bar">
      <div className="activity-bar-top">
        <div 
            className={`activity-item ${activeView === 'explorer' ? 'active' : ''}`}
            onClick={() => handleItemClick('explorer')}
            title="Explorer"
        >
            <ExplorerIcon />
        </div>
        <div 
            className={`activity-item ${activeView === 'search' ? 'active' : ''}`}
            onClick={() => handleItemClick('search')}
            title="Search"
        >
            <SearchIcon />
        </div>
        <div 
            className={`activity-item ${activeView === 'components' ? 'active' : ''}`}
            onClick={() => handleItemClick('components')}
            title="Components"
        >
            <ComponentsIcon />
        </div>
      </div>
      
      <div className="activity-bar-bottom">
        <div 
            className={`activity-item ${activeView === 'account' ? 'active' : ''}`}
            onClick={() => handleItemClick('account')}
            title="Account"
        >
            <UserIcon />
        </div>
        <div 
            className={`activity-item ${activeView === 'settings' ? 'active' : ''}`}
            onClick={() => handleItemClick('settings')}
            title="Settings"
        >
            <SettingsIcon />
        </div>
      </div>
    </div>
  );
};

export default ActivityBar;

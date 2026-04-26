import React from 'react';
import './ActivityBar.css';

export type ActivityView = 'explorer' | 'search' | 'docs' | 'packs' | 'settings' | 'account' | null;

interface ActivityBarProps {
  activeView: ActivityView;
  onViewChange: (view: ActivityView) => void;
}

// Icons defined outside the component to avoid recreation on every render
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

const DocsIcon = () => (
  <svg className="activity-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
  </svg>
);

const PacksIcon = () => (
  <svg className="activity-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
      <line x1="12" y1="22.08" x2="12" y2="12"></line>
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

const ActivityBar: React.FC<ActivityBarProps> = ({ activeView, onViewChange }) => {

  const handleItemClick = (view: ActivityView) => {
    onViewChange(view);
  };

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
            className={`activity-item ${activeView === 'docs' ? 'active' : ''}`}
            onClick={() => handleItemClick('docs')}
            title="User Docs"
        >
            <DocsIcon />
        </div>
        <div 
            className={`activity-item ${activeView === 'packs' ? 'active' : ''}`}
            onClick={() => handleItemClick('packs')}
            title="Operation Packs"
        >
            <PacksIcon />
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

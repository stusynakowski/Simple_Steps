import './WorkflowTabs.css';

export interface WorkflowTab {
  id: string;
  title: string;
  isActive: boolean;
  isModified?: boolean;
}

interface WorkflowTabsProps {
  tabs: WorkflowTab[];
  onTabClick: (id: string) => void;
  onTabClose: (id: string) => void;
  onNewTab: () => void;
}

export default function WorkflowTabs({ tabs, onTabClick, onTabClose, onNewTab }: WorkflowTabsProps) {
  return (
    <div className="workflow-tabs-container">
      <div className="workflow-tabs-list">
        {tabs.map(tab => (
          <div 
            key={tab.id} 
            className={`workflow-tab ${tab.isActive ? 'active' : ''}`}
            onClick={() => onTabClick(tab.id)}
            title={tab.title}
          >
            <span className="tab-icon">
                {/* Optional icon, e.g. file type icon */}
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M11 1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h6zm0 1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z"/>
                </svg>
            </span>
            <span className="tab-title">{tab.title}</span>
            {tab.isModified && <span className="tab-modified-indicator">●</span>}
            <button 
              className="tab-close-btn"
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(tab.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
       <button className="new-tab-btn" onClick={onNewTab} title="New Workflow">
        +
      </button>
    </div>
  );
}

import Icon from './Icon';
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
              {/* `json` codicon — these are JSON pipeline files; matches VS Code's tab icon */}
              <Icon name="json" size={14} />
            </span>
            <span className="tab-title">{tab.title}</span>
            {tab.isModified && <span className="tab-modified-indicator">●</span>}
            <button
              className="tab-close-btn"
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(tab.id);
              }}
              aria-label="Close tab"
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
      </div>
      <button className="new-tab-btn" onClick={onNewTab} title="New Workflow" aria-label="New workflow">
        <Icon name="add" size={14} />
      </button>
    </div>
  );
}

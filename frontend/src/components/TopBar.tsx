import './TopBar.css';

interface TopBarProps {
  onLoad?: () => void;
  onSave?: () => void;
  onSettings?: () => void;
  onAddStep?: () => void;
  title?: string;
  showAddStep?: boolean;
}

export default function TopBar({ onLoad, onSave, onSettings, onAddStep, showAddStep = true }: TopBarProps) {
  return (
    <div className="topbar" data-testid="topbar">
      <div className="topbar-left">
        <button onClick={onLoad} data-testid="btn-load" className="tool-btn">
          Load
        </button>
        <button onClick={onSave} data-testid="btn-save" className="tool-btn">
          Save
        </button>
        <button onClick={onSettings} data-testid="btn-settings" className="tool-btn">
          Settings
        </button>
      </div>
      
      <div className="topbar-center">
        <div className="search-bar-container">
            <span className="search-icon">
                <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
                    <path fillRule="evenodd" clipRule="evenodd" d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.75.75 0 0 1-1.06 1.06l-3.04-3.04zm-4.43.76a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z"/>
                </svg>
            </span>
            <input type="text" className="search-input" placeholder="Simple Steps" />
        </div>
      </div>

      <div className="topbar-right">
        {showAddStep && (
          <button onClick={onAddStep} data-testid="btn-add-step" className="primary-btn">
            + Add Step
          </button>
        )}
      </div>
    </div>
  );
}


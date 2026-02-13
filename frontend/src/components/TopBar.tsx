import './TopBar.css';

interface TopBarProps {
  onLoad?: () => void;
  onSave?: () => void;
  onSettings?: () => void;
  onAddStep?: () => void;
  onToggleChat?: () => void;
  title?: string;
  showAddStep?: boolean;
}

export default function TopBar({ onLoad, onSave, onSettings, onAddStep, onToggleChat, showAddStep = true }: TopBarProps) {
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
      <div className="topbar-right">
        {showAddStep && (
          <button onClick={onAddStep} data-testid="btn-add-step" className="primary-btn">
            + Add Step
          </button>
        )}
        {onToggleChat && (
          <button onClick={onToggleChat} title="Toggle Copilot Chat" className="tool-btn chat-toggle-btn">
            Chat
          </button>
        )}
      </div>
    </div>
  );
}


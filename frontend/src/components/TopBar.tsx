interface TopBarProps {
  onLoad?: () => void;
  onSave?: () => void;
  onSettings?: () => void;
  title?: string;
}

export default function TopBar({ onLoad, onSave, onSettings, title = 'Simple Steps' }: TopBarProps) {
  return (
    <div className="topbar" data-testid="topbar">
      <div className="topbar-left">
        <h1 className="app-title">{title}</h1>
      </div>
      <div className="topbar-right">
        <button onClick={onLoad} data-testid="btn-load">
          Load
        </button>
        <button onClick={onSave} data-testid="btn-save">
          Save
        </button>
        <button onClick={onSettings} data-testid="btn-settings">
          Settings
        </button>
      </div>
    </div>
  );
}

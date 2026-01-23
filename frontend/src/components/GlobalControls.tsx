import React from 'react';
import './GlobalControls.css';

interface GlobalControlsProps {
  onRunAll: () => void;
  onPauseAll: () => void;
}

export default function GlobalControls({ onRunAll, onPauseAll }: GlobalControlsProps) {
  return (
    <div className="global-controls">
      <div className="control-group">
        <button className="control-btn run-btn" onClick={onRunAll} title="Run Workflow">
          <span className="icon">▶</span> Run
        </button>
        <button className="control-btn pause-btn" onClick={onPauseAll} title="Pause Workflow">
          <span className="icon">⏸</span> Pause
        </button>
      </div>
      
      <div className="status-widget">
        <span className="status-dot online"></span>
        <span className="status-text">Backend: Online</span>
      </div>

      <div className="holistic-widget">
         <span className="holistic-label">Holistic Analysis (Pending)</span>
      </div>
    </div>
  );
}

import { useState } from 'react';
import './AgentWidget.css';

export default function AgentWidget() {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className={`agent-widget ${expanded ? 'expanded' : 'collapsed'}`} data-testid="agent-widget">
      <div className="agent-header" onClick={() => setExpanded(!expanded)}>
        <span className="agent-title">Agent</span>
        <button className="expander-btn">{expanded ? '▼' : '▶'}</button>
      </div>
      {expanded && (
        <div className="agent-body">Agent Widget (mock)</div>
      )}
    </div>
  );
}

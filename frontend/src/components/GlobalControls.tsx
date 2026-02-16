import { useState } from 'react';
import './GlobalControls.css';

interface GlobalControlsProps {
  onRunAll: () => void;
  onPauseAll: () => void;
  onStopAll: () => void;
  pipelineStatus: 'idle' | 'running' | 'paused';
}

export default function GlobalControls({ onRunAll, onPauseAll, onStopAll, pipelineStatus }: GlobalControlsProps) {
  const [computeTarget, setComputeTarget] = useState('Local');
  const [pythonEnv, setPythonEnv] = useState('simple-steps-env');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [resources, setResources] = useState(['OpenAI', 'Postgres']);

  return (
    <div className="global-controls">
      <div className="metadata-row">
        <div className="control-item" title="Where the pipeline is executed">
          <label>Compute:</label>
          <select value={computeTarget} onChange={(e) => setComputeTarget(e.target.value)} className="control-select">
            <option value="Local">Local</option>
            <option value="Remote">Remote Cluster</option>
            <option value="Cloud">Cloud Runner</option>
          </select>
        </div>

        <div className="separator"></div>

        <div className="control-item" title="Python Environment">
          <label>Env:</label>
           <select value={pythonEnv} onChange={(e) => setPythonEnv(e.target.value)} className="control-select">
            <option value="simple-steps-env">simple-steps-env (3.11)</option>
            <option value="base">base (3.10)</option>
            <option value="data-sci">data-sci (3.12)</option>
          </select>
        </div>

        <div className="separator"></div>

        <div className="control-item resources-item" title="Available Resources (APIs, DBs, Models)">
           <label>Resources:</label>
           <div className="resources-display">
              {resources.map(r => (
                  <span key={r} className="resource-tag">{r}</span>
              ))}
              <button 
                className="resource-add" 
                onClick={() => {
                    const newRes = prompt("Add resource (e.g. 'AWS S3')");
                    if (newRes) setResources([...resources, newRes]);
                }}
              >+</button>
           </div>
        </div>

        <div className="right-align-group">
          <div className="status-widget">
            <span className={`status-dot ${pipelineStatus === 'running' ? 'running' : 'online'}`}></span>
            <span className="status-text">Backend: {pipelineStatus === 'running' ? 'Running' : 'Online'}</span>
          </div>
        </div>
      </div>

      <div className="execution-row">
        <div className="control-group main-controls">
            {pipelineStatus === 'running' ? (
                <button className="control-btn pause-btn" onClick={onPauseAll} title="Pause Workflow">
                    <span className="icon">⏸</span> Pause
                </button>
            ) : (
                <button 
                  className={`control-btn run-btn ${pipelineStatus === 'paused' ? 'resume-btn' : ''}`} 
                  onClick={onRunAll} 
                  title={pipelineStatus === 'paused' ? "Resume Workflow" : "Run Workflow"}
                >
                    <span className="icon">▶</span> {pipelineStatus === 'paused' ? "Resume" : "Run Pipeline"}
                </button>
            )}
            
            <button 
              className="control-btn stop-btn" 
              onClick={onStopAll} 
              title="Stop Workflow"
              disabled={pipelineStatus === 'idle'}
            >
              <span className="icon">⏹</span> Stop
            </button>
        </div>
      </div>
    </div>
  );
}

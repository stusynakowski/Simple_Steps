import { useState, useCallback, useRef, useEffect } from 'react';
import TopBar from './TopBar';
import AgentWidget from './AgentWidget';
import GlobalControls from './GlobalControls';
import OperationColumn from './OperationColumn';
import useWorkflow from '../hooks/useWorkflow';
import { getStepColor } from '../styles/theme';
import './MainLayout.css';

export default function MainLayout() {
  const [headerHeight, setHeaderHeight] = useState(200);
  const isResizing = useRef(false);

  const { 
    workflow, 
    expandedStepIds, 
    addStepAt, 
    toggleStep, 
    collapseStep, 
    runStep, 
    deleteStep 
  } = useWorkflow();

  const startResizing = useCallback(() => {
    isResizing.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const stopResizing = useCallback(() => {
    isResizing.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const resize = useCallback((mouseMoveEvent: any) => {
    if (isResizing.current) {
        const newHeight = Math.max(120, Math.min(mouseMoveEvent.clientY, 600)); 
        setHeaderHeight(newHeight);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [resize, stopResizing]);

  const handleRunAll = () => {
    // Basic implementation: Run all steps
    workflow.steps.forEach(s => runStep(s.id));
  };
  
  const handlePauseAll = () => {
    console.log('Pause All');
  };

  return (
    <div className="main-layout" data-testid="main-layout">
      <header className="header-container" style={{ height: headerHeight }}>
        <div className="system-tools-row">
            <TopBar 
               onAddStep={() => addStepAt(workflow.steps.length)} 
               showAddStep={false} 
            />
        </div>
        <div className="workflow-tools-row">
            <div className="workflow-controls-wrapper">
                <GlobalControls onRunAll={handleRunAll} onPauseAll={handlePauseAll} />
            </div>
            <div className="agent-wrapper">
                <AgentWidget />
            </div>
        </div>
      </header>

      <div className="resize-handle" onMouseDown={startResizing}>
         <div className="resize-line" />
      </div>
      
      <main className={`main-content horizontal-scroll-area`}>
        <div className="columns-container" data-testid="columns-container">
            {workflow.steps.map((step, index) => {
              const isExpanded = expandedStepIds.has(step.id);
              return (
                <div key={step.id} className={`column-wrapper ${isExpanded ? 'expanded' : 'collapsed'}`}>
                    <OperationColumn
                        step={step}
                        color={getStepColor(index)}
                        isActive={isExpanded}
                        isSqueezed={!isExpanded}
                        onActivate={() => toggleStep(step.id)}
                        onRun={runStep}
                        onPause={(id) => console.log('Pause', id)} 
                        onDelete={deleteStep}
                        onMinimize={() => collapseStep(step.id)}
                    />
                </div>
              );
            })}
            
            <div className="add-step-container">
              <button 
                className="add-step-button rectangular-add-btn"
                onClick={() => addStepAt(workflow.steps.length)}
                title="Add New Step"
              >
                Add Step +
              </button>
            </div>
        </div>
      </main>
    </div>
  );
}


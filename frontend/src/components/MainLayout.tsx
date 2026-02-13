import { useState, useCallback, useRef, useEffect } from 'react';
import TopBar from './TopBar';
import AgentWidget from './AgentWidget';
import GlobalControls from './GlobalControls';
import OperationColumn from './OperationColumn';
import useWorkflow from '../hooks/useWorkflow';
import { getStepColor } from '../styles/theme';
import Sidebar from './Sidebar';
import ChatSidebar from './ChatSidebar';
import './MainLayout.css';

export default function MainLayout() {
  const [headerHeight, setHeaderHeight] = useState(200);
  const [sidebarWidth, setSidebarWidth] = useState(250);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(300);
  const [isChatVisible, setIsChatVisible] = useState(true);
  const isResizingHeader = useRef(false);
  const isResizingSidebar = useRef(false);
  const isResizingRightSidebar = useRef(false);

  const { 
    workflow, 
    expandedStepIds, 
    addStepAt, 
    toggleStep, 
    collapseStep, 
    runStep, 
    deleteStep 
  } = useWorkflow();

  const startResizingHeader = useCallback(() => {
    isResizingHeader.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const startResizingSidebar = useCallback(() => {
    isResizingSidebar.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const startResizingRightSidebar = useCallback(() => {
    isResizingRightSidebar.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const stopResizing = useCallback(() => {
    isResizingHeader.current = false;
    isResizingSidebar.current = false;
    isResizingRightSidebar.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const resize = useCallback((mouseMoveEvent: any) => {
    if (isResizingHeader.current) {
        const newHeight = Math.max(120, Math.min(mouseMoveEvent.clientY, 600)); 
        setHeaderHeight(newHeight);
    }
    if (isResizingSidebar.current) {
        const newWidth = Math.max(150, Math.min(mouseMoveEvent.clientX, 500));
        setSidebarWidth(newWidth);
    }
    if (isResizingRightSidebar.current) {
        const newWidth = Math.max(200, Math.min(window.innerWidth - mouseMoveEvent.clientX, 600));
        setRightSidebarWidth(newWidth);
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
        <div style={{ width: sidebarWidth, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <Sidebar isVisible={true} />
        </div>
        
        <div className="sidebar-resize-handle" onMouseDown={startResizingSidebar}>
            <div className="sidebar-resize-line" />
        </div>

      <div className="content-area">
      <header className="header-container" style={{ height: headerHeight }}>
        <div className="system-tools-row">
            <TopBar 
               onAddStep={() => addStepAt(workflow.steps.length)} 
               showAddStep={false} 
               onToggleChat={() => setIsChatVisible(!isChatVisible)}
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

      <div className="resize-handle" onMouseDown={startResizingHeader}>
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
                        zIndex={workflow.steps.length - index}
                        onActivate={() => toggleStep(step.id)}
                        onRun={runStep}
                        onPause={(id) => console.log('Pause', id)} 
                        onDelete={deleteStep}
                        onMinimize={() => collapseStep(step.id)}
                    />
                </div>
              );
            })}
        </div>
      </main>
      </div> 

      {isChatVisible && (
        <>
            <div className="sidebar-resize-handle" onMouseDown={startResizingRightSidebar}>
                <div className="sidebar-resize-line" />
            </div>
            <div style={{ width: rightSidebarWidth, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                <ChatSidebar isVisible={isChatVisible} onClose={() => setIsChatVisible(false)} />
            </div>
        </>
      )}
    </div>
  );
}


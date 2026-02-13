import { useState, useCallback, useRef, useEffect } from 'react';
import TopBar from './TopBar';
import AgentWidget from './AgentWidget';
import GlobalControls from './GlobalControls';
import OperationColumn from './OperationColumn';
import useWorkflow from '../hooks/useWorkflow';
import { getStepColor } from '../styles/theme';
import Sidebar from './Sidebar';
import ChatSidebar from './ChatSidebar';
import ActivityBar from './ActivityBar';
import type { ActivityView } from './ActivityBar';
import './MainLayout.css';

export default function MainLayout() {
  const [headerHeight, setHeaderHeight] = useState(200);
  const [sidebarWidth, setSidebarWidth] = useState(250);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(300);
  const [isChatVisible, setIsChatVisible] = useState(true);
  const [activeActivityView, setActiveActivityView] = useState<ActivityView>('explorer');
  
  // Track dragging state to disable transitions
  const [isDragging, setIsDragging] = useState(false);

  const isResizingHeader = useRef(false);
  const isResizingSidebar = useRef(false);
  const isResizingRightSidebar = useRef(false);

  // Store previous widths for restoring after collapse
  const lastRightSidebarWidth = useRef(300);
  const lastSidebarWidth = useRef(250);
  const lastHeaderHeight = useRef(200);

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
    setIsDragging(true);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);
  
  const toggleHeader = useCallback(() => {
      if (headerHeight > 60) {
          lastHeaderHeight.current = headerHeight;
          setHeaderHeight(50); // Collapse to just TopBar
      } else {
          setHeaderHeight(lastHeaderHeight.current > 60 ? lastHeaderHeight.current : 200);
      }
  }, [headerHeight]);

  const startResizingSidebar = useCallback(() => {
    isResizingSidebar.current = true;
    setIsDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);
  
  const toggleSidebar = useCallback(() => {
     if (sidebarWidth > 20) {
         lastSidebarWidth.current = sidebarWidth;
         setSidebarWidth(0); // Fully collapse
     } else {
         setSidebarWidth(lastSidebarWidth.current > 20 ? lastSidebarWidth.current : 250);
     }
  }, [sidebarWidth]);

  const startResizingRightSidebar = useCallback(() => {
    isResizingRightSidebar.current = true;
    setIsDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const stopResizing = useCallback(() => {
    isResizingHeader.current = false;
    isResizingSidebar.current = false;
    isResizingRightSidebar.current = false;
    setIsDragging(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
        
    // Update last known sizes if we were resizing
    // We only update if the current size is "expanded" (greater than minimal collapse)
    // This prevents overwriting the "restored" size with the "collapsed" size if a drag event fires accidentally?
    // Actually, dragging normally implies user intent to set size.
    // If I drag while collapsed, I should probably expand?
  }, []);
  // Note: we update refs in resize/stopResizing usually, but with state it's tricky to get "previous" if we snap.
  // actually 'resize' updates the state. The 'ref' should be updated when we invoke the collapse logic?
  // Or just update the ref whenever we have a "good" size?
  // Let's just trust that manual resize sets the state, and we use the ref only for restoration.
  // But usage of 'resize' callback might need to update refs? No, manual resize is manual.
  
  const resize = useCallback((mouseMoveEvent: any) => {
    if (isResizingHeader.current) {
        const newHeight = Math.max(50, Math.min(mouseMoveEvent.clientY, 600)); 
        setHeaderHeight(newHeight);
        if (newHeight > 60) lastHeaderHeight.current = newHeight;
    }
    if (isResizingSidebar.current) {
        const newWidth = Math.max(0, Math.min(mouseMoveEvent.clientX, 500));
        setSidebarWidth(newWidth);
        if (newWidth > 50) lastSidebarWidth.current = newWidth;
    }
    if (isResizingRightSidebar.current) {
        const newWidth = Math.max(0, Math.min(window.innerWidth - mouseMoveEvent.clientX, 600));
        setRightSidebarWidth(newWidth);
        if (newWidth > 50) lastRightSidebarWidth.current = newWidth;
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

  const handleViewChange = (view: ActivityView) => {
      if (view === activeActivityView) {
          // Toggle sidebar visibility
          if (sidebarWidth > 0) {
              lastSidebarWidth.current = sidebarWidth;
              setSidebarWidth(0);
          } else {
              setSidebarWidth(lastSidebarWidth.current > 20 ? lastSidebarWidth.current : 250);
          }
      } else {
          // Switch view and ensure open
          setActiveActivityView(view);
          if (sidebarWidth === 0) {
               setSidebarWidth(lastSidebarWidth.current > 20 ? lastSidebarWidth.current : 250);
          }
      }
  };

  const handleRunAll = () => {
    // Basic implementation: Run all steps
    workflow.steps.forEach(s => runStep(s.id));
  };
  
  const handlePauseAll = () => {
    console.log('Pause All');
  };

  const toggleChat = () => {
      if (isChatVisible) {
          setIsChatVisible(false);
          // If we want to animate out, we might handle it via width, but for now specific width logic:
          // We'll keep isChatVisible for logic, but maybe use width 0?
          // Actually let's use the width variable to control visibility animation
      } else {
          setIsChatVisible(true);
          setRightSidebarWidth(lastRightSidebarWidth.current > 0 ? lastRightSidebarWidth.current : 300);
      }
  };
  
  // Transition style
  const transitionStyle = isDragging ? 'none' : 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1), height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)';

  return (
    <div className="main-layout" data-testid="main-layout">
        <ActivityBar activeView={activeActivityView} onViewChange={handleViewChange} />
        
        <div style={{ 
            width: sidebarWidth, 
            flexShrink: 0, 
            display: 'flex', 
            flexDirection: 'column',
            transition: transitionStyle,
            overflow: 'hidden',
            borderRight: sidebarWidth > 0 ? '1px solid #333' : 'none' // Add border here if needed, or rely on sidebar's internal styles
        }}>
            <Sidebar isVisible={true} currentView={activeActivityView} />
        </div>
        
        <div className="sidebar-resize-handle" onMouseDown={startResizingSidebar} onDoubleClick={toggleSidebar} title="Double-click to verify size">
            <div className="sidebar-resize-line" />
            <button 
                className="resize-toggle-btn"
                onClick={(e) => { e.stopPropagation(); toggleSidebar(); }}
                onMouseDown={(e) => e.stopPropagation()}
                title={sidebarWidth > 20 ? "Collapse Sidebar" : "Expand Sidebar"}
            >
                {sidebarWidth > 20 ? '◀' : '▶'}
            </button>
        </div>

      <div className="content-area">
      <header className="header-container" style={{ 
          height: headerHeight,
          transition: transitionStyle
      }}>
        <div className="system-tools-row">
            <TopBar 
               onAddStep={() => addStepAt(workflow.steps.length)} 
               showAddStep={false} 
               onToggleChat={toggleChat}
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

      <div className="resize-handle" onMouseDown={startResizingHeader} onDoubleClick={toggleHeader} title="Double-click to minimize/expand">
         <div className="resize-line" />
         <button 
            className="resize-toggle-btn"
            onClick={(e) => { e.stopPropagation(); toggleHeader(); }}
            onMouseDown={(e) => e.stopPropagation()}
            title={headerHeight > 60 ? "Collapse Header" : "Expand Header"}
         >
            {headerHeight > 60 ? '▲' : '▼'}
         </button>
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
            
            <div className="add-step-container">
                <button 
                  className="rectangular-add-btn" 
                  onClick={() => addStepAt(workflow.steps.length)}
                  title="Add New Step"
                >
                  + Add Step
                </button>
            </div>
        </div>
      </main>
      </div> 

      
        <div className="sidebar-resize-handle" onMouseDown={startResizingRightSidebar} style={{display: isChatVisible ? 'flex' : 'none'}}>
            <div className="sidebar-resize-line" />
            <button 
                className="resize-toggle-btn"
                onClick={(e) => { e.stopPropagation(); toggleChat(); }}
                onMouseDown={(e) => e.stopPropagation()}
                title="Close Chat"
            >
                ▶
            </button>
        </div>
        <div style={{ 
            width: isChatVisible ? rightSidebarWidth : 0, 
            flexShrink: 0, 
            display: 'flex', 
            flexDirection: 'column',
            overflow: 'hidden',
            transition: transitionStyle,
            opacity: isChatVisible ? 1 : 0 // Fade out content as well
        }}>
            <ChatSidebar isVisible={true /* Always rendered, hiding controlled by parent width */} onClose={toggleChat} />
        </div>
    </div>
  );
}


import TopBar from './TopBar';
import AgentWidget from './AgentWidget';
import GlobalControls from './GlobalControls';
import OperationColumn from './OperationColumn';
import useWorkflow from '../hooks/useWorkflow';
import { getStepColor } from '../styles/theme';
import './MainLayout.css';

export default function MainLayout() {
  const { 
    workflow, 
    expandedStepIds, 
    addStepAt, 
    toggleStep, 
    collapseStep, 
    runStep, 
    deleteStep 
  } = useWorkflow();

  const handleRunAll = () => {
    // Basic implementation: Run all steps
    workflow.steps.forEach(s => runStep(s.id));
  };
  
  const handlePauseAll = () => {
    console.log('Pause All');
  };

  return (
    <div className="main-layout" data-testid="main-layout">
      <header className="header-container">
        <div className="agent-area">
          <AgentWidget />
        </div>
        <div className="controls-area">
          <GlobalControls onRunAll={handleRunAll} onPauseAll={handlePauseAll} />
          {/* Keep TopBar for Load/Save checks, though visually it might need adjustment */}
          <TopBar 
             onAddStep={() => addStepAt(workflow.steps.length)} 
             showAddStep={false} // We will hide the old button
          />
        </div>
      </header>
      
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
            
            {/* Phase 5: New Add Button */}
           <div className="add-step-container">
              <button 
                className="add-step-button"
                onClick={() => addStepAt(workflow.steps.length)}
                title="Add New Step"
              >
                +
              </button>
            </div>
        </div>
      </main>
    </div>
  );
}

import TopBar from './TopBar';
import AgentWidget from './AgentWidget';
import OperationColumn from './OperationColumn';
import useWorkflow from '../hooks/useWorkflow';
import './MainLayout.css';

export default function MainLayout() {
  const { workflow, selectedStepId, addStepAt, selectStep, runStep, deleteStep } = useWorkflow();

  return (
    <div className="main-layout" data-testid="main-layout">
      <header className="header">
        <TopBar />
        <AgentWidget />
      </header>
      
      <main className="main-content horizontal-scroll-area">
        <div className="columns-container" data-testid="columns-container">
            {workflow.steps.map((step, index) => (
                <div key={step.id} className="column-wrapper">
                    <OperationColumn
                        step={step}
                        isActive={selectedStepId === step.id}
                        onActivate={selectStep}
                        onRun={runStep}
                        onPause={(id) => console.log('Pause', id)} 
                        onDelete={deleteStep}
                    />
                    <button 
                        className="add-column-btn" 
                        onClick={() => addStepAt(index + 1)}
                        title="Add Step After"
                        data-testid={`btn-add-${index}`}
                    >
                        +
                    </button>
                </div>
            ))}
            {workflow.steps.length === 0 && (
                <div className="empty-state">
                    <button onClick={() => addStepAt(0)}>Add First Step</button>
                </div>
            )}
        </div>
      </main>
    </div>
  );
}

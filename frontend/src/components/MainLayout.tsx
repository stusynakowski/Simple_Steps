import TopBar from './TopBar';
import AgentWidget from './AgentWidget';
import WorkflowSequence from './WorkflowSequence';
import StepDetailView from './StepDetailView';
import useWorkflow from '../hooks/useWorkflow';
import './MainLayout.css';

export default function MainLayout() {
  const { workflow, selectedStepId, addStepAt, selectStep, runStep, deleteStep } = useWorkflow();
  const selectedStep = workflow.steps.find((s) => s.id === selectedStepId) ?? null;

  return (
    <div className="main-layout" data-testid="main-layout">
      <header className="header">
        <TopBar />
        <AgentWidget />
      </header>

      <main className="main-content">
        <section className="workflow-area" data-testid="workflow-area">
          <WorkflowSequence
            steps={workflow.steps}
            selectedStepId={selectedStepId}
            onSelect={selectStep}
            onAdd={addStepAt}
          />
        </section>

        <section className="step-detail" data-testid="step-detail">
          <StepDetailView
            step={selectedStep}
            onRun={runStep}
            onDelete={deleteStep}
            onEdit={() => {}}
            onCellClick={() => {}}
          />
        </section>
      </main>
    </div>
  );
}

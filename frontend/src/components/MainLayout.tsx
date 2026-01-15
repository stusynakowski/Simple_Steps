import TopBar from './TopBar';
import AgentWidget from './AgentWidget';
import './MainLayout.css';

export default function MainLayout() {
  return (
    <div className="main-layout" data-testid="main-layout">
      <header className="header">
        <TopBar />
        <AgentWidget />
      </header>

      <main className="main-content">
        <section className="workflow-area" data-testid="workflow-area">
          Workflow Visualizer (Placeholder)
        </section>

        <section className="step-detail" data-testid="step-detail">
          Step Detail (Placeholder)
        </section>
      </main>
    </div>
  );
}

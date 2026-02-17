import { useState } from 'react';
import type { Step, Cell } from '../types/models';
import type { OperationDefinition } from '../services/api';
import './StepDetailView.css';
import StepToolbar from './StepToolbar';
import DataOutputGrid from './DataOutputGrid';

interface StepDetailViewProps {
  step: Step | null;
  availableOperations?: OperationDefinition[];
  onRun?: (id: string) => void;
  onDelete?: (id: string) => void;
  onEdit?: (id: string) => void;
  onCellClick?: (cell: Cell) => void;
  onFormulaChange?: (id: string, formula: string) => void;
}

export default function StepDetailView({ step, availableOperations, onRun, onDelete, onEdit, onCellClick, onFormulaChange }: StepDetailViewProps) {
  const [activeTab, setActiveTab] = useState<'output' | 'summary'>('output');

  if (!step) {
    return <div data-testid="step-detail-empty">No step selected</div>;
  }

  const preview = step.output_preview ?? [];

  return (
    <div data-testid="step-detail-content" className="step-detail-view">
      <div className="detail-header">
        <h3>{step.label}</h3>
        <div className="detail-meta">
          <div>Status: {step.status}</div>
          <div>Type: {step.process_type}</div>
        </div>
      </div>

      <StepToolbar 
        step={step} 
        availableOperations={availableOperations}
        onRun={onRun} 
        onDelete={onDelete} 
        onEdit={() => onEdit?.(step.id)} 
        onFormulaChange={onFormulaChange}
      />

      <div className="step-tabs">
        <button 
          className={`step-tab ${activeTab === 'output' ? 'active' : ''}`}
          onClick={() => setActiveTab('output')}
        >
          Output
        </button>
        <button 
          className={`step-tab ${activeTab === 'summary' ? 'active' : ''}`}
          onClick={() => setActiveTab('summary')}
        >
          Summary
        </button>
      </div>

      <div className="step-tab-content">
        {activeTab === 'output' && (
          <DataOutputGrid cells={preview} onCellClick={onCellClick} />
        )}
        {activeTab === 'summary' && (
          <div className="step-summary">
            <h4>Pipeline Status</h4>
            <div className="summary-item">
              <span className="label">Step Status:</span>
              <span className={`status-badge status-${step.status}`}>{step.status}</span>
            </div>
            <div className="summary-item">
               <span className="label">Step Type:</span>
               <span>{step.process_type}</span>
            </div>
            <div className="summary-item">
               <span className="label">Step ID:</span>
               <span>{step.id}</span>
            </div>
             <div className="summary-info">
              <p>General status of the pipeline details for this step.</p>
              {/* Placeholder for more detailed pipeline capability status */}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import type { Step } from '../types/models';
import type { OperationDefinition } from '../services/api'; // Import OperationDefinition

interface StepToolbarProps {
  step: Step;
  availableOperations?: OperationDefinition[];
  onRun?: (id: string) => void;
  onDelete?: (id: string) => void;
  onEdit?: (id: string) => void;
  onFormulaChange?: (id: string, formula: string) => void;
  // Toggle handlers
  onToggleFormula?: () => void;
  onToggleData?: () => void;
  onToggleConfig?: () => void;
  onToggleSummary?: () => void;
  // State for toggles
  showFormula?: boolean;
  showSummary?: boolean;
  showConfig?: boolean;
  showData?: boolean;
}

export default function StepToolbar({ 
  step, 
  availableOperations, 
  onRun, 
  onDelete, 
  onUpdate, // Assuming parent handles config updates
  onFormulaChange,
  onToggleFormula,
  onToggleData,
  onToggleConfig,
  onToggleSummary,
  showFormula = false,
  showSummary,
  showConfig,
  showData,
}: StepToolbarProps & { onUpdate?: (id: string, updates: Partial<Step>) => void }) {
  // Local state for immediate UI feedback
  const [formula, setFormula] = useState(step.operation || '');

  // Sync with prop if the step data changes externally
  useEffect(() => {
    setFormula(step.operation || '');
  }, [step.operation]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    setFormula(newVal);
    onFormulaChange?.(step.id, newVal);
  };

  return (
    <div className="toolbar-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px', borderBottom: '1px solid #eee' }}>
      <div className="toolbar" data-testid="step-toolbar" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        {/* Run/Stop Button */}
        <button 
          className="btn-icon" 
          onClick={(e) => { e.stopPropagation(); onRun?.(step.id); }} 
          title={step.status === 'running' ? 'Stop' : 'Run'}
          data-testid="btn-run"
        >
          {step.status === 'running' ? '⏹' : '▶'}
        </button>

        <div className="divider-vertical" style={{ width: 1, height: 16, background: '#eee', margin: '0 4px' }} />

        {/* Toggle Controls */}
        <button 
          className={`btn-icon ${showFormula ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleFormula?.(); }}
          title="Toggle Formula Bar"
        >
          ƒ
        </button>
        
        <button 
          className={`btn-icon ${showConfig ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleConfig?.(); }}
          title="Toggle Configuration"
        >
          ⚙
        </button>

        <button 
          className={`btn-icon ${showData ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleData?.(); }}
          title="Toggle Data View"
        >
          ▤
        </button>

        <button 
          className={`btn-icon ${showSummary ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleSummary?.(); }}
          title="Toggle Summary View"
        >
          📊
        </button>

        <button 
          className="btn-icon" 
          onClick={(e) => { e.stopPropagation(); onToggleSummary?.(); }}
          title="Toggle Summary View"
        >
          📊
        </button>

        <div style={{ flex: 1 }} />

        {/* Delete Action */}
        <button 
          className="btn-icon danger" 
          onClick={(e) => { e.stopPropagation(); onDelete?.(step.id); }}
          title="Delete Step"
          data-testid="btn-delete"
        >
          🗑
        </button>
      </div>
      
      {/* Formula Bar Section */}
      {showFormula && (
      <div className="formula-bar" style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
        <span style={{ color: '#666', fontWeight: 'bold', fontFamily: 'serif', fontStyle: 'italic' }}>fx</span>
        <input
          type="text"
          value={formula}
          onChange={handleInputChange}
          placeholder={availableOperations?.length ? `Try =${availableOperations[0].id}(...)` : "=OPERATION(StepName!A:B)"}
          list="operations-list"
          style={{
            flex: 1,
            padding: '4px 8px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontFamily: 'monospace'
          }}
          data-testid="formula-input"
        />
        <datalist id="operations-list">
          {availableOperations?.map(op => (
            <option key={op.id} value={`=${op.id}(`} />
          ))}
        </datalist>
      </div>
     )}
    </div>
  );
}

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
  onToggleData?: () => void;
  onToggleConfig?: () => void;
  onToggleSummary?: () => void;
  // State for toggles
  showSummary?: boolean;
  showConfig?: boolean;
  showData?: boolean;
}

export default function StepToolbar({ 
  step, 
  availableOperations, 
  onRun, 
  onDelete, 
  onFormulaChange,
  onToggleData,
  onToggleConfig,
  onToggleSummary,
  showSummary,
  showConfig,
  showData,
}: StepToolbarProps) {
  // Local state for immediate UI feedback
  const [formula, setFormula] = useState(step.operation || '');

  // Sync with prop if the step data changes externally
  useEffect(() => {
    if (step.operation !== formula) {
      setFormula(step.operation || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.operation]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    setFormula(newVal);
    onFormulaChange?.(step.id, newVal);
  };

  return (
    <div className="toolbar-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px', borderBottom: '1px solid #eee' }}>
      {/* Formula Bar Section - Now on Top */}
      <div className="formula-bar" style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
        <span style={{ color: '#666', fontWeight: 'bold', fontFamily: 'serif', fontStyle: 'italic' }}>fx</span>
        <input
          type="text"
          value={formula}
          onChange={handleInputChange}
          placeholder={availableOperations?.length ? `Try =${availableOperations[0].id}(...)` : "=OPERATION(StepName!A:B)"}
          list={`operations-list-${step.id}`}
          style={{
            flex: 1,
            padding: '4px 8px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontFamily: 'monospace'
          }}
          data-testid="formula-input"
        />
        <datalist id={`operations-list-${step.id}`}>
          {availableOperations?.map(op => (
            <option key={op.id} value={`=${op.id}(`} />
          ))}
        </datalist>
      </div>

      <div className="toolbar" data-testid="step-toolbar" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        {/* Run/Stop Button - Always prominent */}
        <button 
          className="btn-icon" 
          onClick={(e) => { e.stopPropagation(); onRun?.(step.id); }} 
          title={step.status === 'running' ? 'Stop' : 'Run'}
          data-testid="btn-run"
          style={{ 
            color: step.status === 'running' ? '#e74c3c' : '#2ecc71',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          {step.status === 'running' ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          )}
        </button>

        <div className="divider-vertical" style={{ width: 1, height: 16, background: '#eee', margin: '0 4px' }} />

        {/* View Toggles - Subtle by default, colored when active */}
        <button 
          className={`btn-icon toggle ${showConfig ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleConfig?.(); }}
          title="Toggle Configuration"
          style={{ 
            color: showConfig ? '#3498db' : '#95a5a6',
            background: showConfig ? '#ebf5fb' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
          </svg>
        </button>

        <button 
          className={`btn-icon toggle ${showData ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleData?.(); }}
          title="Toggle Data View"
          style={{ 
            color: showData ? '#9b59b6' : '#95a5a6',
            background: showData ? '#f4ecf7' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="3" y1="9" x2="21" y2="9"></line>
            <line x1="9" y1="21" x2="9" y2="9"></line>
          </svg>
        </button>

        <button 
          className={`btn-icon toggle ${showSummary ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleSummary?.(); }}
          title="Toggle Summary View"
          style={{ 
            color: showSummary ? '#f39c12' : '#95a5a6',
            background: showSummary ? '#fef9e7' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"></line>
            <line x1="12" y1="20" x2="12" y2="4"></line>
            <line x1="6" y1="20" x2="6" y2="14"></line>
          </svg>
        </button>

        <div style={{ flex: 1 }} />

        {/* Delete Action - Subtle until hovered (handled by CSS usually, but setting base here) */}
        <button 
          className="btn-icon danger" 
          onClick={(e) => { e.stopPropagation(); onDelete?.(step.id); }}
          title="Delete Step"
          data-testid="btn-delete"
          style={{ color: '#e74c3c', opacity: 0.6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    </div>
  );
}

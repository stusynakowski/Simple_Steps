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
  // Tab handlers
  activeTab: 'summary' | 'details' | 'data';
  onTabChange: (tab: 'summary' | 'details' | 'data') => void;
}

export default function StepToolbar({ 
  step, 
  availableOperations, 
  onRun, 
  onDelete, 
  onFormulaChange,
  activeTab,
  onTabChange,
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

        {/* Tab Buttons as Icons - Beside Run Button */}
        <button
          className={`btn-icon tab-icon ${activeTab === 'summary' ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onTabChange('summary'); }}
          title="Summary"
          style={{
            position: 'relative',
            color: activeTab === 'summary' ? '#f39c12' : '#95a5a6',
            background: activeTab === 'summary' ? '#fef9e7' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10"></line>
                <line x1="12" y1="20" x2="12" y2="4"></line>
                <line x1="6" y1="20" x2="6" y2="14"></line>
            </svg>
            {activeTab === 'summary' && (
                <div style={{
                    position: 'absolute',
                    bottom: '-4px', // Connect to content below
                    left: 0, 
                    right: 0,
                    height: '2px',
                    background: '#f39c12',
                    zIndex: 10
                }}/>
            )}
        </button>

        <button
          className={`btn-icon tab-icon ${activeTab === 'details' ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onTabChange('details'); }}
          title="Operation Details"
          style={{
            position: 'relative',
            color: activeTab === 'details' ? '#3498db' : '#95a5a6',
            background: activeTab === 'details' ? '#ebf5fb' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            {activeTab === 'details' && (
                <div style={{
                    position: 'absolute',
                    bottom: '-4px', 
                    left: 0, 
                    right: 0,
                    height: '2px',
                    background: '#3498db',
                    zIndex: 10
                }}/>
            )}
        </button>

        <button
          className={`btn-icon tab-icon ${activeTab === 'data' ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onTabChange('data'); }}
          title="Data View"
          style={{
            position: 'relative',
            color: activeTab === 'data' ? '#9b59b6' : '#95a5a6',
            background: activeTab === 'data' ? '#f4ecf7' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
            </svg>
            {activeTab === 'data' && (
                <div style={{
                    position: 'absolute',
                    bottom: '-4px', 
                    left: 0, 
                    right: 0,
                    height: '2px',
                    background: '#9b59b6',
                    zIndex: 10
                }}/>
            )}
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

      {/* Tabs Bar Removed */}
      <div style={{ display: 'none' }}></div>
    </div>
  );
}

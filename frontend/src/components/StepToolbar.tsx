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
  activeTab: 'summary' | 'details' | 'data' | 'settings';
  onTabChange: (tab: 'summary' | 'details' | 'data' | 'settings') => void;
  onMaximize?: () => void;
  isMaximized?: boolean;
  onLock?: (id: string) => void;
  isLocked?: boolean;
  onConfigure?: (id: string) => void;
}

export default function StepToolbar({ 
  step, 
  availableOperations, 
  onRun, 
  onDelete, 
  onFormulaChange,
  activeTab, 
  onTabChange, 
  onMaximize, 
  isMaximized,
  onLock,
  isLocked,
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
      <div className="toolbar" data-testid="step-toolbar" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        
        {/* Summary Button (Levels Icon) */}
        <button
          className={`btn-icon tab-icon ${activeTab === 'summary' ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onTabChange('summary'); }}
          title="Step Summary"
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

        {/* Data Button (Database Icon) */}
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

        {/* Function Button (Fx Icon) - Activated Details */}
        <button 
          className={`btn-icon tab-icon ${activeTab === 'details' ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onTabChange('details'); }}
          title="Operation Functionality"
          style={{ 
              color: activeTab === 'details' ? '#3498db' : '#666', 
              background: activeTab === 'details' ? '#ebf5fb' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
            <span style={{ fontSize: '12px', fontWeight: 'bold', fontFamily: 'serif', fontStyle: 'italic' }}>fx</span>
        </button>

         {/* Settings Button (Gear Icon) - Activated Settings */}
         <button
          className={`btn-icon tab-icon ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onTabChange('settings'); }}
          title="Miscellaneous Settings"
          style={{
            position: 'relative',
            color: activeTab === 'settings' ? '#7f8c8d' : '#95a5a6',
            background: activeTab === 'settings' ? '#f0f3f4' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            {activeTab === 'settings' && (
                <div style={{
                    position: 'absolute',
                    bottom: '-4px', // Connect to content below
                    left: 0, 
                    right: 0,
                    height: '2px',
                    background: '#7f8c8d',
                    zIndex: 10
                }}/>
            )}
        </button>



        <div style={{ flex: 1 }} />

        {/* Maximize/Restore Button - Now on the Right */}
        {onMaximize && (
            <button
                className="btn-icon"
                onClick={(e) => { e.stopPropagation(); onMaximize(); }}
                title={isMaximized ? "Restore Size" : "Maximize"}
                style={{
                  color: '#666',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginRight: 4
                }}
            >
                {isMaximized ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path>
                    </svg>
                ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 3 21 3 21 9"></polyline>
                        <polyline points="9 21 3 21 3 15"></polyline>
                        <line x1="21" y1="3" x2="14" y2="10"></line>
                        <line x1="3" y1="21" x2="10" y2="14"></line>
                    </svg>
                )}
            </button>
        )}

        {/* Lock Button */}
        <button 
          className="btn-icon" 
          onClick={(e) => { e.stopPropagation(); onLock?.(step.id); }}
          title={isLocked ? "Unlock Step" : "Lock Step"}
          style={{ 
              color: isLocked ? '#f39c12' : '#ccc', 
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginRight: 4
          }}
        >
          {isLocked ? (
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
               <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
               <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
             </svg>
          ) : (
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
             </svg>
          )}
        </button>

        {/* Delete Action - Always visible but behaves differently based on lock state */}
        <button 
            className="btn-icon danger" 
            onClick={(e) => { 
                e.stopPropagation(); 
                if (isLocked) {
                    alert("This operation is locked. Please unlock it to delete.");
                } else {
                    onDelete?.(step.id); 
                }
            }}
            title={isLocked ? "Operation is locked" : "Delete Step"}
            data-testid="btn-delete"
            style={{ 
                color: '#e74c3c', 
                opacity: isLocked ? 0.3 : 1, 
                cursor: isLocked ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center' 
            }}
        >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
        </button>
      </div>

      {/* Formula Bar Section - Now on Top */}
      <div className="formula-bar" style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
        
        {/* Run/Stop Button - Moved Next to Formula Bar */}
        <button 
          className="btn-icon" 
          onClick={(e) => { e.stopPropagation(); onRun?.(step.id); }} 
          title={step.status === 'running' ? 'Stop' : 'Run'}
          data-testid="btn-run"
          style={{ 
            color: step.status === 'running' ? '#e74c3c' : '#2ecc71',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 4 // slightly smaller padding for inline feel?
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

      {/* Tabs Bar Removed */}
      <div style={{ display: 'none' }}></div>
    </div>
  );
}

/**
 * PreviousStepDataPicker
 *
 * Renders a compact panel showing all previous steps' output columns and
 * cells as clickable badges. When a badge is clicked, `onTokenSelect` is
 * called with the reference token (e.g. `step-abc.url`). The parent
 * (OperationColumn) handles focusing the formula bar and injecting the token.
 */

import { useState } from 'react';
import type { Step } from '../types/models';

interface PreviousStepDataPickerProps {
  /** All steps that appear before the current one in the pipeline. */
  previousSteps: Step[];
  /** Called when a badge is clicked with the reference token string. */
  onTokenSelect: (token: string) => void;
}

export default function PreviousStepDataPicker({
  previousSteps,
  onTokenSelect,
}: PreviousStepDataPickerProps) {
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  const stepsWithOutput = previousSteps.filter(
    (s) => s.outputColumns && s.outputColumns.length > 0
  );

  if (stepsWithOutput.length === 0) {
    // No previous steps with output columns — still show steps with preview data
    const stepsWithPreview = previousSteps.filter(
      (s) => s.output_preview && s.output_preview.length > 0
    );
    if (stepsWithPreview.length === 0) {
      if (previousSteps.length === 0) return null;
      return (
        <div style={containerStyle}>
          <div style={headerStyle}>
            <span>⚡</span> Previous Step Data
          </div>
          <div style={{ padding: '6px 10px', fontSize: '0.72rem', color: '#999', fontStyle: 'italic' }}>
            Run previous steps to see their data here
          </div>
        </div>
      );
    }
  }

  const relevantSteps =
    stepsWithOutput.length > 0 ? stepsWithOutput : previousSteps;

  const handleColumnBadgeClick = (stepId: string, col: string) => {
    const token = `${stepId}.${col}`;
    onTokenSelect(token);
  };

  const handleCellBadgeClick = (stepId: string, rowId: number, col: string) => {
    const token = `${stepId}[row=${rowId}, col=${col}]`;
    onTokenSelect(token);
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <span>⚡</span> Previous Step Data
        <span style={{ marginLeft: 4, fontWeight: 400, opacity: 0.8, fontSize: '0.68rem' }}>
          — click to insert reference
        </span>
      </div>

      {relevantSteps.map((step) => {
        const cols =
          step.outputColumns && step.outputColumns.length > 0
            ? step.outputColumns
            : getColumnsFromPreview(step);

        const isExpanded = expandedStep === step.id;
        const previewRows = step.output_preview?.slice(0, 3) ?? [];

        return (
          <div key={step.id} style={stepBlockStyle}>
            {/* Step label row */}
            <div
              style={stepLabelStyle}
              onClick={() => setExpandedStep(isExpanded ? null : step.id)}
              title={`Step: ${step.id}`}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: statusColor(step.status),
                  marginRight: 5,
                  flexShrink: 0,
                }}
              />
              <strong style={{ fontSize: '0.75rem', color: '#333' }}>{step.label}</strong>
              {cols.length > 0 && (
                <span style={{ marginLeft: 4, fontSize: '0.68rem', color: '#999' }}>
                  {cols.length} col{cols.length !== 1 ? 's' : ''}
                </span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: '#bbb' }}>
                {isExpanded ? '▲' : '▼'}
              </span>
            </div>

            {/* Column badges — always visible */}
            {cols.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 8px 4px 16px' }}>
                {cols.map((col) => (
                  <button
                    key={col}
                    onMouseDown={(e) => {
                      e.preventDefault(); // Don't blur formula bar
                      handleColumnBadgeClick(step.id, col);
                    }}
                    title={`Insert column reference: ${step.id}.${col}`}
                    style={colBadgeStyle}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = '#ffc107';
                      (e.currentTarget as HTMLButtonElement).style.color = '#5d4037';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = '#fff8e1';
                      (e.currentTarget as HTMLButtonElement).style.color = '#7b5e00';
                    }}
                  >
                    ⚡ {col}
                  </button>
                ))}
              </div>
            )}

            {/* Expanded: show sample cells */}
            {isExpanded && previewRows.length > 0 && (
              <div style={{ padding: '0 8px 6px 16px' }}>
                <div style={{ fontSize: '0.67rem', color: '#aaa', marginBottom: 3 }}>
                  Sample cells (click to reference specific value):
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {previewRows.map((cell) => (
                    <button
                      key={`${cell.row_id}:${cell.column_id}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleCellBadgeClick(step.id, cell.row_id, cell.column_id);
                      }}
                      title={`Insert cell reference: ${step.id}[row=${cell.row_id}, col=${cell.column_id}]`}
                      style={cellBadgeStyle}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = '#fff3cd';
                        (e.currentTarget as HTMLButtonElement).style.borderColor = '#ffa000';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = '#fafafa';
                        (e.currentTarget as HTMLButtonElement).style.borderColor = '#e0e0e0';
                      }}
                    >
                      <span style={{ color: '#aaa', fontFamily: 'monospace', fontSize: '0.65rem' }}>
                        [{cell.row_id},{cell.column_id}]
                      </span>
                      <span style={{ marginLeft: 6, fontFamily: 'monospace', fontSize: '0.72rem', color: '#555' }}>
                        {String(cell.display_value).slice(0, 40)}
                        {String(cell.display_value).length > 40 ? '…' : ''}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* No data hint */}
            {cols.length === 0 && (
              <div style={{ padding: '2px 8px 4px 16px', fontSize: '0.68rem', color: '#bbb', fontStyle: 'italic' }}>
                Run this step to see columns
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function getColumnsFromPreview(step: Step): string[] {
  if (!step.output_preview || step.output_preview.length === 0) return [];
  return Array.from(new Set(step.output_preview.map((c) => c.column_id)));
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return '#2ecc71';
    case 'running': return '#3498db';
    case 'error': return '#e74c3c';
    case 'paused': return '#f39c12';
    default: return '#bbb';
  }
}

// ── Styles ────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  marginTop: 10,
  border: '1px solid #ffe082',
  borderRadius: 5,
  background: 'linear-gradient(180deg, #fffde7 0%, #fff8e1 100%)',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '5px 10px',
  background: 'linear-gradient(90deg, #fff3cd 0%, #fff8e1 100%)',
  borderBottom: '1px solid #ffe082',
  fontSize: '0.72rem',
  fontWeight: 700,
  color: '#7b5e00',
  letterSpacing: '0.02em',
};

const stepBlockStyle: React.CSSProperties = {
  borderBottom: '1px solid #fff3cd',
};

const stepLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '4px 10px',
  cursor: 'pointer',
  userSelect: 'none',
  background: 'transparent',
  borderBottom: '1px solid #fff3cd',
};

const colBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  padding: '2px 7px',
  borderRadius: 10,
  border: '1px solid #ffd54f',
  background: '#fff8e1',
  color: '#7b5e00',
  fontSize: '0.7rem',
  fontFamily: 'monospace',
  cursor: 'crosshair',
  transition: 'all 0.1s ease',
  userSelect: 'none',
};

const cellBadgeStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  padding: '3px 7px',
  borderRadius: 4,
  border: '1px solid #e0e0e0',
  background: '#fafafa',
  cursor: 'crosshair',
  textAlign: 'left',
  transition: 'all 0.1s ease',
  userSelect: 'none',
};

/**
 * SessionManager
 *
 * The left-panel view for everything the *session* owns, as opposed to
 * everything a *run* does:
 *
 *   Resource Manager — the compute target, the Python environment, and
 *                      (once the backend exposes them) the runtime resources
 *                      tools get injected: LLM clients, database handles.
 *   Tool Registry    — every registered operation, grouped by category.
 *
 * Both of these used to be dropdowns in `UnifiedToolbar`. They moved here so
 * the toolbar can be purely execution management — run, pause, stop, logs —
 * and so the registry gets room to be browsed rather than peeked at.
 */

import React, { useMemo, useState } from 'react';
import Icon from './Icon';
import type { OperationDefinition } from '../services/api';
import './SessionManager.css';

interface SessionManagerProps {
  /** Every operation the backend has registered. */
  availableOperations?: OperationDefinition[];
}

/** Colour per orchestration type — matches the formula-bar autocomplete. */
const TYPE_BADGE_COLORS: Record<string, string> = {
  source: '#4ec9b0',
  map: '#569cd6',
  filter: '#ce9178',
  dataframe: '#b5cea8',
  expand: '#d7ba7d',
  raw_output: '#c586c0',
  orchestrator: '#9cdcfe',
};

/** A collapsible section header, used for both halves of the panel. */
const SectionHeader: React.FC<{
  label: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
}> = ({ label, count, open, onToggle }) => (
  <button
    type="button"
    className="sm-section-header"
    onClick={onToggle}
    aria-expanded={open}
  >
    <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
    <span className="sm-section-label">{label}</span>
    {count !== undefined && <span className="sm-section-count">{count}</span>}
  </button>
);

export default function SessionManager({
  availableOperations = [],
}: SessionManagerProps) {
  // Section open/closed state
  const [resourcesOpen, setResourcesOpen] = useState(true);
  const [registryOpen, setRegistryOpen] = useState(true);

  // Resource manager — local until the backend exposes real resources.
  const [computeTarget, setComputeTarget] = useState('Local');
  const [pythonEnv, setPythonEnv] = useState('simple-steps-env');

  // Tool registry
  const [filterText, setFilterText] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const filteredOps = useMemo(() => {
    if (!filterText) return availableOperations;
    const lower = filterText.toLowerCase();
    return availableOperations.filter(op =>
      op.id.toLowerCase().includes(lower) ||
      op.label.toLowerCase().includes(lower) ||
      op.category.toLowerCase().includes(lower)
    );
  }, [availableOperations, filterText]);

  const groupedOps = useMemo(() => {
    const acc: Record<string, OperationDefinition[]> = {};
    for (const op of filteredOps) {
      const cat = op.category || 'Uncategorized';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(op);
    }
    return acc;
  }, [filteredOps]);

  const sortedCategories = useMemo(() => Object.keys(groupedOps).sort(), [groupedOps]);

  // While filtering, show every match expanded — collapsing hides the results.
  const isCategoryOpen = (cat: string) =>
    filterText ? true : expandedCategories.has(cat);

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div className="session-manager" data-testid="session-manager">

      {/* ── Resource Manager ─────────────────────────────────────────── */}
      <SectionHeader
        label="Resource Manager"
        open={resourcesOpen}
        onToggle={() => setResourcesOpen(v => !v)}
      />

      {resourcesOpen && (
        <div className="sm-section-body">
          <div className="sm-field">
            <label className="sm-field-label" htmlFor="sm-compute">Compute</label>
            <select
              id="sm-compute"
              className="sm-select"
              value={computeTarget}
              onChange={e => setComputeTarget(e.target.value)}
            >
              <option value="Local">Local</option>
              <option value="Remote">Remote Cluster</option>
              <option value="Cloud">Cloud Runner</option>
            </select>
          </div>

          <div className="sm-field">
            <label className="sm-field-label" htmlFor="sm-pyenv">Python Env</label>
            <select
              id="sm-pyenv"
              className="sm-select"
              value={pythonEnv}
              onChange={e => setPythonEnv(e.target.value)}
            >
              <option value="simple-steps-env">simple-steps-env (3.11)</option>
              <option value="base">base (3.10)</option>
              <option value="data-sci">data-sci (3.12)</option>
            </select>
          </div>

          {/* Runtime resources — injected into tools, never user-supplied.
              The backend does not expose these yet; this is the slot. */}
          <div className="sm-subsection">
            <div className="sm-subsection-label">Runtime Resources</div>
            <div className="sm-empty">
              No resources registered. Databases and model clients declared by
              the developer appear here, and are injected into tools rather
              than entered by hand.
            </div>
          </div>
        </div>
      )}

      {/* ── Tool Registry ────────────────────────────────────────────── */}
      <SectionHeader
        label="Tool Registry"
        count={availableOperations.length}
        open={registryOpen}
        onToggle={() => setRegistryOpen(v => !v)}
      />

      {registryOpen && (
        <div className="sm-section-body sm-registry-body">
          <div className="sm-filter">
            <input
              id="sm-registry-filter"
              type="text"
              className="sm-filter-input"
              placeholder="Filter tools…"
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
            />
            {filterText && (
              <button
                type="button"
                className="sm-filter-clear"
                onClick={() => setFilterText('')}
                aria-label="Clear filter"
              >
                ×
              </button>
            )}
          </div>

          {availableOperations.length === 0 && (
            <div className="sm-empty">
              No tools registered — is the backend running?
            </div>
          )}

          {filteredOps.length === 0 && availableOperations.length > 0 && (
            <div className="sm-empty">No tools match “{filterText}”.</div>
          )}

          <div className="sm-registry-list">
            {sortedCategories.map(cat => {
              const ops = groupedOps[cat];
              const open = isCategoryOpen(cat);
              return (
                <div key={cat} className="sm-category">
                  <button
                    type="button"
                    className="sm-category-row"
                    onClick={() => toggleCategory(cat)}
                    aria-expanded={open}
                  >
                    <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} />
                    <span className="sm-category-label">{cat}</span>
                    <span className="sm-category-count">{ops.length}</span>
                  </button>

                  {open && (
                    <div className="sm-ops">
                      {ops.map(op => (
                        <div
                          key={op.id}
                          className="sm-op-row"
                          title={op.description || op.id}
                        >
                          <span className="sm-op-icon">ƒ</span>
                          <span className="sm-op-name">{op.label}</span>
                          <span
                            className="sm-op-badge"
                            style={{ background: TYPE_BADGE_COLORS[op.type] || '#666' }}
                          >
                            {op.type}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

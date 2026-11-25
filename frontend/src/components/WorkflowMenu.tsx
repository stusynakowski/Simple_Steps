import { useLayoutEffect, useRef, useState } from 'react';
import type { StepGroup, Workflow } from '../types/models';
import { StepPop, popUnder, type PopAt } from './StepMenu';

/**
 * The workflow toolbar's Workflow menu (owner, 2026-11-24), between Overview
 * and the notes: the workflow's groups, and a new group made from a map of
 * its steps — click a step, shift-click another, name it, Group. A step's
 * "Group this step" opens it with that step picked. Each group's own
 * running, notes and settings are on its band (StepGroupPops).
 */
export default function WorkflowMenu({ workflow, open, pick, onOpen, onClose, colorOfStep, colorOfGroup, onGroup }: {
  workflow: Workflow;
  open: boolean;
  /** A step to start the new group from (a step's "Group this step"). */
  pick: string | null;
  onOpen: () => void;
  onClose: () => void;
  colorOfStep: (id: string) => string;
  colorOfGroup: (group: StepGroup) => string;
  /** Group the consecutive steps *ids*, named *name* (or the next `group N`). */
  onGroup: (ids: string[], name: string) => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<PopAt | null>(null);
  const groups = workflow.groups ?? [];
  const steps = workflow.steps;
  const groupOf = (id: string) => groups.find((g) => g.steps.includes(id));

  // The picked run of steps, as indexes (from ≤ to once ordered), and the new group's name.
  const [sel, setSel] = useState<{ from: number; to: number } | null>(null);
  const [name, setName] = useState('');
  useLayoutEffect(() => {
    if (!open) return;
    if (button.current) setAt(popUnder(button.current.getBoundingClientRect()));
    const i = pick ? steps.findIndex((s) => s.id === pick) : -1;
    setSel(i >= 0 ? { from: i, to: i } : null);
    setName('');
    // Only on opening: later edits to the steps keep the pick as it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pick]);

  const lo = sel ? Math.min(sel.from, sel.to) : -1;
  const hi = sel ? Math.max(sel.from, sel.to) : -1;
  const picked = sel ? steps.slice(lo, hi + 1) : [];
  const clash = picked.find((s) => groupOf(s.id));
  const choose = (i: number, extend: boolean) => setSel((s) => (extend && s ? { from: s.from, to: i } : { from: i, to: i }));
  const group = () => {
    if (!picked.length || clash) return;
    onGroup(picked.map((s) => s.id), name.trim());
    setSel(null);
    setName('');
  };

  return (
    <div className="ut-group">
      <button
        ref={button}
        type="button"
        className={`ut-dropdown-trigger${open ? ' active' : ''}`}
        title="The workflow's groups: make and see them"
        data-testid="workflow-menu"
        aria-expanded={open}
        onClick={() => (open ? onClose() : onOpen())}
      >
        <span>Workflow</span>
        <span className="ut-badge">{groups.length}</span>
        <span className="ut-caret">▾</span>
      </button>
      {open && at && (
        <StepPop at={at} label="Workflow menu" title="Workflow" anchor={button} onClose={onClose} testId="workflow-menu-pop">
          <div className="wm-section">Groups</div>
          {groups.length === 0 ? (
            <div className="wm-empty">No groups yet: pick steps below.</div>
          ) : groups.map((g) => {
            const first = steps.find((s) => s.id === g.steps[0])?.label ?? '?';
            const last = steps.find((s) => s.id === g.steps[g.steps.length - 1])?.label ?? '?';
            return (
              <div key={g.name} className="wm-group-row" data-testid={`wm-group-${g.name}`}>
                <span className="wm-swatch" style={{ background: colorOfGroup(g) }} />
                <span className="wm-group-name">{g.name}</span>
                <span className="wm-group-steps">
                  {g.steps.length === 1 ? first : `${first} → ${last}`} · {g.steps.length} step{g.steps.length === 1 ? '' : 's'}
                </span>
              </div>
            );
          })}

          <div className="wm-section">New group</div>
          <div className="wm-hint">Click a step, shift-click another: the steps between join too.</div>
          <div className="wm-map" data-testid="wm-map">
            {steps.map((s, i) => {
              const g = groupOf(s.id);
              const on = sel !== null && i >= lo && i <= hi;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`wm-chip${on ? ' on' : ''}${g ? ' grouped' : ''}`}
                  style={{ '--chip': colorOfStep(s.id), '--group': g ? colorOfGroup(g) : 'transparent' } as React.CSSProperties}
                  title={g ? `${s.label}: in ${g.name}` : s.label}
                  data-testid={`wm-chip-${s.label}`}
                  onClick={(e) => choose(i, e.shiftKey)}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          {clash && <div className="wm-error">{clash.label} is already in {groupOf(clash.id)!.name}: a step is in one group at most.</div>}
          <div className="wm-new">
            <input
              className="wm-name"
              value={name}
              placeholder="name (optional)"
              aria-label="The new group's name"
              data-testid="wm-name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') group(); }}
            />
            <button type="button" className="wm-group-btn" disabled={!picked.length || !!clash} data-testid="wm-group" onClick={group}>
              Group{picked.length ? ` ${picked.length}` : ''}
            </button>
          </div>
        </StepPop>
      )}
    </div>
  );
}

import { useState } from 'react';
import Markdown from 'react-markdown';
import type { StepGroup, Workflow } from '../types/models';
import StepMenu, { StepPop, type PopAt } from './StepMenu';
import SymbolIcon from './SymbolIcon';
import { GROUP_PALETTE } from '../styles/theme';
import { groupRunState } from '../utils/runState';

/**
 * A step group's controls (dev_plan/141, owner 2026-11-17): buttons inline
 * on the group's half of its steps' headers, as a step header's controls
 * sit on it, each with its popover: run options, notes, settings (name,
 * steps, colour, ungroup) and fold.
 */

/** The group whose settings are open, and where. */
export interface OpenSettings { name: string; at: PopAt }

/** The buttons on a group's band: Run options, Notes, Settings, Fold. */
export function GroupControls({ workflow, group, folded, onRun, onMeta, onSettings, onFold }: {
  workflow: Workflow;
  group: StepGroup;
  folded: boolean;
  onRun: (name: string, force: boolean) => void;
  onMeta: (name: string, changes: { color?: string; notes?: string }) => void;
  onSettings: (rect: DOMRect) => void;
  onFold: () => void;
}) {
  const [editingNotes, setEditingNotes] = useState(false);
  const running = workflow.steps.some((s) => group.steps.includes(s.id) && s.status === 'running');
  const run = groupRunState(group);
  const waiting = Object.keys(group.needsRun ?? {}).length;
  const status = running ? 'running' : run.kind === 'ran' ? 'ran' : run.text.replace(/ \(.*\)$/, '');
  const blocked = group.problem ? "core can't run it" : running ? 'running' : undefined;
  const notes = group.meta?.notes ?? '';
  return (
    <span className="group-controls" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <StepMenu
        icon="playlist_play"
        iconSize={13}
        label={`Run options for ${group.name}`}
        testId="group-run-options"
        className="step-header-btn"
        align="right"
        items={[
          { icon: 'play_arrow', label: 'Run group', hint: blocked ?? `${status}${waiting ? ` · ${waiting} to run` : ''}`,
            disabled: !!blocked, onClick: () => onRun(group.name, false), testId: 'run-group' },
          { icon: 'refresh', label: 'Run again', hint: blocked ?? 'even if up to date',
            disabled: !!blocked, onClick: () => onRun(group.name, true), testId: 'run-group-again' },
        ]}
      />
      <StepMenu icon="sticky_note_2" iconSize={12} label={`${group.name}'s notes`} testId="group-notes-menu"
        className={`step-header-btn${notes ? ' has-notes' : ''}`} align="right">
        <div className="group-pop-notes">
          {editingNotes || !notes ? (
            <textarea
              className="step-notes-inline-input"
              aria-label={`${group.name}'s notes (Markdown)`}
              data-testid="group-notes"
              rows={5}
              value={notes}
              autoFocus
              onChange={(e) => onMeta(group.name, { notes: e.target.value })}
              onBlur={() => setEditingNotes(false)}
              placeholder="What this group is for (Markdown)"
            />
          ) : (
            <div className="step-notes-body" onDoubleClick={() => setEditingNotes(true)} title="Double-click to edit">
              <Markdown>{notes}</Markdown>
              <button type="button" className="step-header-btn step-notes-edit-btn" title="Edit the notes"
                aria-label={`Edit ${group.name}'s notes`} data-testid="group-notes-edit" onClick={() => setEditingNotes(true)}>
                <SymbolIcon name="edit_note" size={14} />
              </button>
            </div>
          )}
        </div>
      </StepMenu>
      <button type="button" className="step-header-btn" title="Group settings: name, steps, colour"
        aria-label={`${group.name}'s settings`} data-testid="group-settings-btn"
        onClick={(e) => onSettings(e.currentTarget.getBoundingClientRect())}>
        <SymbolIcon name="tune" size={13} />
      </button>
      <button type="button" className="step-header-btn" title={folded ? 'Unfold the group' : 'Fold the group'}
        aria-label={folded ? `Unfold ${group.name}` : `Fold ${group.name}`} data-testid="group-fold" onClick={onFold}>
        <SymbolIcon name={folded ? 'unfold_more' : 'unfold_less'} size={13} />
      </button>
    </span>
  );
}

/** Steps a group could take in: outside any other group, and not past one (a group is consecutive steps). */
function canAdd(workflow: Workflow, group: StepGroup, id: string): boolean {
  const order = workflow.steps.map((s) => s.id);
  const at = [...group.steps, id].map((x) => order.indexOf(x));
  const span = order.slice(Math.min(...at), Math.max(...at) + 1);
  return !(workflow.groups ?? []).some((g) => g.name !== group.name && g.steps.some((s) => span.includes(s)));
}

/**
 * A group's settings: its name, its steps as a multiselect (a chip per step,
 * × to take it out, a list to add one: a group is consecutive steps, so
 * adding a step further away brings in the steps between), its colour, and
 * Ungroup.
 */
export function GroupSettingsPop({ workflow, open, color, onRename, onSteps, onMeta, onUngroup, onClose }: {
  workflow: Workflow;
  open: OpenSettings;
  color: string;
  /** Rename; false when refused (empty, or another group has the name). */
  onRename: (from: string, to: string) => boolean;
  /** The group's steps become *ids* (consecutive, in order). */
  onSteps: (name: string, ids: string[]) => void;
  onMeta: (name: string, changes: { color?: string; notes?: string }) => void;
  onUngroup: (name: string) => void;
  onClose: () => void;
}) {
  const group = (workflow.groups ?? []).find((g) => g.name === open.name);
  const [name, setName] = useState(open.name);
  const [refused, setRefused] = useState(false);
  if (!group) return null;
  const order = workflow.steps.map((s) => s.id);
  const label = (id: string) => workflow.steps.find((s) => s.id === id)?.label ?? id;
  const commit = () => setRefused(!onRename(open.name, name));
  const add = (id: string) => {
    const at = [...group.steps, id].map((x) => order.indexOf(x));
    onSteps(group.name, order.slice(Math.min(...at), Math.max(...at) + 1));
  };
  const addable = workflow.steps.filter((s) => !group.steps.includes(s.id) && canAdd(workflow, group, s.id));
  return (
    <StepPop at={open.at} label={`Group ${open.name}`} title="Group settings" testId="group-settings" onClose={() => { commit(); onClose(); }}>
      <label className="group-set-row">
        <span>Name</span>
        <input
          className="group-set-name"
          value={name}
          aria-invalid={refused}
          data-testid="group-name"
          onChange={(e) => { setName(e.target.value); setRefused(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
          onBlur={commit}
        />
      </label>
      {refused && <div className="group-set-error">A group needs a name no other group has.</div>}
      {group.problem && <div className="group-set-error">{group.problem}</div>}
      <div className="group-set-row group-set-steps-row">
        <span>Steps</span>
        <div className="group-multiselect" data-testid="group-steps">
          {group.steps.map((id, k) => {
            const end = k === 0 || k === group.steps.length - 1;
            const can = end && group.steps.length > 1;
            return (
              <span key={id} className="group-chip">
                {label(id)}
                <button
                  type="button"
                  aria-label={`Take ${label(id)} out of ${group.name}`}
                  title={can ? `Take ${label(id)} out` : group.steps.length === 1 ? 'Its only step: Ungroup instead' : 'Only a step at either end can leave'}
                  disabled={!can}
                  data-testid={`group-chip-remove-${label(id)}`}
                  onClick={() => onSteps(group.name, group.steps.filter((x) => x !== id))}
                >
                  <SymbolIcon name="close" size={11} />
                </button>
              </span>
            );
          })}
          {addable.length > 0 && (
            <select
              className="group-add"
              value=""
              aria-label={`Add a step to ${group.name}`}
              data-testid="group-add-step"
              onChange={(e) => { if (e.target.value) add(e.target.value); }}
            >
              <option value="">+ Add step</option>
              {addable.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          )}
        </div>
      </div>
      <div className="group-set-row">
        <span>Colour</span>
        <div className="group-pop-colors" role="radiogroup" aria-label="Group colour">
          {GROUP_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === color}
              aria-label={`Colour ${c}`}
              className={`group-pop-swatch${c === color ? ' checked' : ''}`}
              style={{ background: c }}
              onClick={() => onMeta(group.name, { color: c })}
            />
          ))}
        </div>
      </div>
      <button type="button" className="step-menu-item danger group-set-ungroup" data-testid="ungroup" onClick={() => onUngroup(group.name)}>
        <SymbolIcon name="ungroup" size={15} />
        <span className="step-menu-label">Ungroup</span>
      </button>
    </StepPop>
  );
}

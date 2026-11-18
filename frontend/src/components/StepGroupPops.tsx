import { useState } from 'react';
import type { Workflow } from '../types/models';
import Markdown from 'react-markdown';
import { StepPop, type PopAt } from './StepMenu';
import SymbolIcon from './SymbolIcon';
import { GROUP_PALETTE } from '../styles/theme';
import { groupRunState } from '../utils/runState';

/**
 * Making and managing step groups (dev_plan/141 §3.4, §3.5): the popover of
 * a selection of step headers (shift-click), which groups them, and a
 * group's own popover, opened from its half of the header, which renames or
 * ungroups it. Nothing is added to the grid itself: both are popovers.
 */

/** Shift-clicked step headers, in the order picked, and where their popover sits. */
export interface HeaderSelection { ids: string[]; at: PopAt }
/** The group whose popover is open, and where. */
export interface OpenGroup { name: string; at: PopAt }

/** A click on another step header extends the selection rather than closing it. */
const onHeader = (t: Element) => !!t.closest('.op-header');

/** Why steps *ids* can't be grouped, or '' when they can. */
// eslint-disable-next-line react-refresh/only-export-components
export function whyNotGroup(workflow: Workflow, ids: string[]): string {
  const at = ids.map((id) => workflow.steps.findIndex((s) => s.id === id)).sort((a, b) => a - b);
  if (at.some((i, k) => k > 0 && i !== at[k - 1] + 1)) return 'Pick steps next to each other';
  const taken = workflow.steps.filter((s) => ids.includes(s.id)
    && (workflow.groups ?? []).some((g) => g.steps.includes(s.id)));
  if (taken.length) return `${taken.map((s) => s.label).join(', ')} ${taken.length === 1 ? 'is' : 'are'} already in a group`;
  return '';
}

/** The selection's popover: *Group steps*, or why not. */
export function SelectionPop({ workflow, selection, onGroup, onClose }: {
  workflow: Workflow;
  selection: HeaderSelection;
  onGroup: (ids: string[]) => void;
  onClose: () => void;
}) {
  const why = whyNotGroup(workflow, selection.ids);
  const n = selection.ids.length;
  return (
    <StepPop
      at={selection.at}
      label="Selected steps"
      title={`${n} step${n === 1 ? '' : 's'} selected`}
      testId="header-selection-pop"
      inside={onHeader}
      onClose={onClose}
      items={[
        { icon: 'stacks', label: 'Group steps', hint: why || undefined, disabled: !!why,
          onClick: () => onGroup(selection.ids), testId: 'group-steps' },
        { icon: 'close', label: 'Clear selection', onClick: onClose },
      ]}
    />
  );
}

/**
 * A group's popover, a mini workflow manager (§3.4): its name (renamed in
 * place), where it stands, Run group / Run again (only its steps), its
 * colour and notes, and Ungroup.
 */
export function GroupPop({ workflow, open, color, folded, onRename, onRun, onMeta, onFold, onUngroup, onClose }: {
  workflow: Workflow;
  open: OpenGroup;
  /** The colour it shows now (its own, or the palette's). */
  color: string;
  /** Rename; false when refused (empty, or another group has the name). */
  onRename: (from: string, to: string) => boolean;
  onRun: (name: string, force: boolean) => void;
  onMeta: (name: string, changes: { color?: string; notes?: string }) => void;
  /** Folded to one header in this browser (§3.3). */
  folded: boolean;
  onFold: (name: string) => void;
  onUngroup: (name: string) => void;
  onClose: () => void;
}) {
  const group = (workflow.groups ?? []).find((g) => g.name === open.name);
  const [name, setName] = useState(open.name);
  const [refused, setRefused] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  if (!group) return null;
  const label = (id: string) => workflow.steps.find((s) => s.id === id)?.label ?? id;
  const labels = group.steps.map(label).join(', ');
  const commit = () => setRefused(!onRename(open.name, name));
  const run = groupRunState(group);
  const waiting = Object.entries(group.needsRun ?? {});
  const running = workflow.steps.some((s) => group.steps.includes(s.id) && s.status === 'running');
  const notes = group.meta?.notes ?? '';
  return (
    <StepPop
      at={open.at}
      label={`Group ${open.name}`}
      title="Group"
      testId="group-pop"
      onClose={() => { commit(); onClose(); }}
      items={[
        { icon: 'play_arrow', label: 'Run group', testId: 'run-group',
          disabled: !!group.problem || running, hint: group.problem ? "core can't run it" : running ? 'running' : undefined,
          onClick: () => onRun(open.name, false) },
        { icon: 'refresh', label: 'Run again', testId: 'run-group-again',
          disabled: !!group.problem || running, hint: group.problem ? "core can't run it" : running ? 'running' : undefined,
          onClick: () => onRun(open.name, true) },
        { icon: folded ? 'unfold_more' : 'unfold_less', label: folded ? 'Unfold group' : 'Fold group',
          testId: 'fold-group', onClick: () => onFold(open.name) },
        { divider: true },
        { icon: 'ungroup', label: 'Ungroup', onClick: () => onUngroup(open.name), danger: true, testId: 'ungroup' },
      ]}
    >
      <label className="group-pop-name">
        <span>Name</span>
        <input
          value={name}
          autoFocus
          aria-invalid={refused}
          data-testid="group-name"
          onChange={(e) => { setName(e.target.value); setRefused(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
          onBlur={commit}
        />
      </label>
      {refused && <div className="group-pop-error">A group needs a name no other group has.</div>}
      {group.problem && <div className="group-pop-error">{group.problem}</div>}
      <div className="group-pop-steps">{labels}</div>
      <div className={`group-pop-status run-${run.kind}`} data-testid="group-status">
        {running ? 'running' : run.kind === 'ran' ? 'ran' : run.text.replace(/ \(.*\)$/, '')}
      </div>
      {waiting.length > 0 && (
        <ul className="group-pop-waiting" data-testid="group-needs-run">
          {waiting.map(([step, why]) => <li key={step}><b>{step}</b> {why}</li>)}
        </ul>
      )}
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
            onClick={() => onMeta(open.name, { color: c })}
          />
        ))}
      </div>
      <div className="group-pop-notes">
        {editingNotes || !notes ? (
          <textarea
            className="step-notes-inline-input"
            aria-label={`${open.name}'s notes (Markdown)`}
            data-testid="group-notes"
            rows={editingNotes ? 5 : 2}
            value={notes}
            autoFocus={editingNotes}
            onFocus={() => setEditingNotes(true)}
            onChange={(e) => onMeta(open.name, { notes: e.target.value })}
            onBlur={() => setEditingNotes(false)}
            placeholder="Notes: what this group is for (Markdown)"
          />
        ) : (
          <div className="step-notes-body" onDoubleClick={() => setEditingNotes(true)} title="Double-click to edit">
            <Markdown>{notes}</Markdown>
            <button type="button" className="step-header-btn step-notes-edit-btn" title="Edit the notes"
              aria-label={`Edit ${open.name}'s notes`} data-testid="group-notes-edit" onClick={() => setEditingNotes(true)}>
              <SymbolIcon name="edit_note" size={14} />
            </button>
          </div>
        )}
      </div>
    </StepPop>
  );
}

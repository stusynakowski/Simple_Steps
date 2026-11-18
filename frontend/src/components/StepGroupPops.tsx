import { useState } from 'react';
import type { Workflow } from '../types/models';
import { StepPop, type PopAt } from './StepMenu';

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

/** A group's popover: its name (renamed in place) and Ungroup. Run controls come in G4. */
export function GroupPop({ workflow, open, onRename, onUngroup, onClose }: {
  workflow: Workflow;
  open: OpenGroup;
  /** Rename; false when refused (empty, or another group has the name). */
  onRename: (from: string, to: string) => boolean;
  onUngroup: (name: string) => void;
  onClose: () => void;
}) {
  const group = (workflow.groups ?? []).find((g) => g.name === open.name);
  const [name, setName] = useState(open.name);
  const [refused, setRefused] = useState(false);
  if (!group) return null;
  const labels = group.steps
    .map((id) => workflow.steps.find((s) => s.id === id)?.label)
    .filter(Boolean)
    .join(', ');
  const commit = () => setRefused(!onRename(open.name, name));
  return (
    <StepPop
      at={open.at}
      label={`Group ${open.name}`}
      title="Group"
      testId="group-pop"
      onClose={() => { commit(); onClose(); }}
      items={[
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
    </StepPop>
  );
}

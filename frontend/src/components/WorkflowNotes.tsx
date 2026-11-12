import { useState } from 'react';
import Markdown from 'react-markdown';
import StepMenu from './StepMenu';
import SymbolIcon from './SymbolIcon';
import './WorkflowNotes.css';

/**
 * The workflow's notes (owner, 2026-11-12): a Markdown description of the
 * whole workflow, in a popover on the toolbar's top row. Like a step's notes:
 * shown as Markdown with a button to edit them, and straight to editing when
 * there are none. Saved in the workflow file as `meta.notes`.
 */
export default function WorkflowNotes({ notes, onChange }: {
  notes?: string;
  onChange: (notes: string) => void;
}) {
  const has = !!notes?.trim();
  return (
    <StepMenu
      icon="sticky_note_2"
      iconSize={16}
      text="Notes"
      label={has ? `Workflow notes: ${notes!.trim().split('\n')[0]}` : 'Add workflow notes'}
      testId="workflow-notes"
      className={`ut-btn workflow-notes-btn${has ? ' has-notes' : ''}`}
    >
      <NotesBody notes={notes} onChange={onChange} />
    </StepMenu>
  );
}

/** Mounted each time the popover opens, so it opens to reading (or editing, if empty). */
function NotesBody({ notes, onChange }: { notes?: string; onChange: (notes: string) => void }) {
  const [editing, setEditing] = useState(!notes?.trim());
  if (editing) {
    return (
      <textarea
        autoFocus
        className="workflow-notes-input"
        aria-label="Workflow notes (Markdown)"
        rows={12}
        value={notes ?? ''}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => { if (notes?.trim()) setEditing(false); }}
        placeholder="What is this workflow for? Markdown, e.g. ## Goal"
      />
    );
  }
  return (
    <div className="workflow-notes-view">
      <div className="workflow-notes-body"><Markdown>{notes}</Markdown></div>
      <button
        type="button"
        className="workflow-notes-edit"
        title="Edit the notes"
        aria-label="Edit the workflow notes"
        data-testid="workflow-notes-edit"
        onClick={() => setEditing(true)}
      >
        <SymbolIcon name="edit_note" size={16} />
      </button>
    </div>
  );
}

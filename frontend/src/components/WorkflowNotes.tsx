import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import Fold from './Fold';
import SymbolIcon from './SymbolIcon';
import './WorkflowNotes.css';

/**
 * The workflow's notes (owner, 2026-11-12; an expander since 2026-11-15): a
 * Markdown description of the whole workflow, saved in the workflow file as
 * `meta.notes`. The toggle sits on the toolbar's Overview row; the notes open
 * under it, between that row and the run row, like a Markdown cell at the top
 * of a notebook: no border, read as Markdown, double-click (or the pencil) to
 * edit, and the grip under them drags their height.
 */

/** The grip under the notes: part of their height when open. */
export const NOTES_GRIP = 6;
export const NOTES_MIN = 40;
export const NOTES_MAX = 600;

/** "Workflow Notes ›", drawn as f(x) and the data icon are: blue while open. */
export function WorkflowNotesToggle({ open, hasNotes, onToggle }: {
  open: boolean;
  hasNotes: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`workflow-notes-toggle${open ? ' open' : ''}${hasNotes ? ' has-notes' : ''}`}
      aria-expanded={open}
      title={open ? 'Fold the workflow notes' : hasNotes ? 'Show the workflow notes' : 'Add workflow notes'}
      data-testid="workflow-notes"
      onClick={onToggle}
    >
      <SymbolIcon name="sticky_note_2" size={16} />
      <span>Workflow Notes</span>
      <SymbolIcon name="chevron_right" size={16} className="workflow-notes-caret" />
    </button>
  );
}

/** The notes themselves, between the toolbar's rows; *height* is their body's. */
export function WorkflowNotesPanel({ open, notes, onChange, height, onHeight }: {
  open: boolean;
  notes?: string;
  onChange: (notes: string) => void;
  height: number;
  onHeight: (height: number) => void;
}) {
  const has = !!notes?.trim();
  const [editing, setEditing] = useState(false);
  // Opened with nothing written: straight to writing, and it stays writing
  // as the first words arrive (until the box loses focus).
  useEffect(() => { if (open && !has) setEditing(true); }, [open]);  // eslint-disable-line react-hooks/exhaustive-deps
  // Focus the box once the fold has shown it: a hidden box can't take focus,
  // so autoFocus alone misses while the notes are sliding open.
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!open || !editing) return;
    const t = setTimeout(() => input.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open, editing]);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = height;
    const move = (m: PointerEvent) => onHeight(Math.round(Math.min(NOTES_MAX, Math.max(NOTES_MIN, h0 + m.clientY - y0))));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <Fold open={open}>
      <div className="workflow-notes-panel" data-testid="workflow-notes-panel">
        <div className="workflow-notes-cell" style={{ height }}>
          {editing ? (
            <textarea
              ref={input}
              className="workflow-notes-input"
              aria-label="Workflow notes (Markdown)"
              value={notes ?? ''}
              onChange={(e) => onChange(e.target.value)}
              onBlur={() => setEditing(false)}
              onKeyDown={(e) => { if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur(); }}
              placeholder="What is this workflow for? Markdown, e.g. ## Goal"
            />
          ) : (
            <div className="workflow-notes-view" onDoubleClick={() => setEditing(true)} title="Double-click to edit">
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
          )}
        </div>
        <div
          className="workflow-notes-grip"
          style={{ height: NOTES_GRIP }}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Drag to resize the workflow notes"
          title="Drag to resize"
          onPointerDown={startDrag}
          onDoubleClick={() => onHeight(140)}
        />
      </div>
    </Fold>
  );
}

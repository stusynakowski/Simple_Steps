import { useRef } from 'react';
import './SaveModal.css'; /* reuse same modal styles */

interface RenameModalProps {
  isOpen: boolean;
  currentName: string;
  onClose: () => void;
  onRename: (newName: string) => void;
}

export default function RenameModal({ isOpen, currentName, onClose, onRename }: RenameModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const confirm = () => {
    const trimmed = (inputRef.current?.value ?? currentName).trim();
    if (trimmed) { onRename(trimmed); onClose(); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" style={{ width: 340 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Rename Pipeline</span>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="modal-field">
            <label className="modal-label">New name</label>
            <input
              ref={inputRef}
              className="modal-input"
              defaultValue={currentName}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') onClose(); }}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="modal-cancel-btn" onClick={onClose}>Cancel</button>
          <button className="modal-save-btn" onClick={confirm}>Rename</button>
        </div>
      </div>
    </div>
  );
}

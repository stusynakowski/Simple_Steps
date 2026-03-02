import { useState, useEffect } from 'react';
import './SaveModal.css'; /* reuse same modal styles */

interface RenameModalProps {
  isOpen: boolean;
  currentName: string;
  onClose: () => void;
  onRename: (newName: string) => void;
}

export default function RenameModal({ isOpen, currentName, onClose, onRename }: RenameModalProps) {
  const [name, setName] = useState(currentName);

  useEffect(() => {
    if (isOpen) setName(currentName);
  }, [isOpen, currentName]);

  if (!isOpen) return null;

  const confirm = () => {
    const trimmed = name.trim();
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
              className="modal-input"
              value={name}
              autoFocus
              onChange={e => setName(e.target.value)}
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

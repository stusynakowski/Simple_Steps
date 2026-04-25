import { useState, useRef, useEffect } from 'react';
import './MenuBar.css';

export interface MenuBarAction {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  separator?: boolean;
  onClick: () => void;
}

interface MenuBarProps {
  workflowName: string;
  projectName?: string;
  isModified?: boolean;
  onNew: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onRename: () => void;
  onEditFiles?: () => void;
}

export default function MenuBar({
  workflowName,
  projectName,
  isModified,
  onNew,
  onSave,
  onSaveAs,
  onRename,
  onEditFiles,
}: MenuBarProps) {
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!fileMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setFileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [fileMenuOpen]);

  const fileItems: MenuBarAction[] = [
    { label: 'New Pipeline',     shortcut: '⌘N',  onClick: () => { setFileMenuOpen(false); onNew(); } },
    { label: '', separator: true, onClick: () => {} },
    { label: 'Save',             shortcut: '⌘S',  onClick: () => { setFileMenuOpen(false); onSave(); } },
    { label: 'Save As…',         shortcut: '⇧⌘S', onClick: () => { setFileMenuOpen(false); onSaveAs(); } },
    { label: 'Rename',                             onClick: () => { setFileMenuOpen(false); onRename(); } },
  ];

  return (
    <div className="menubar">
      {/* File menu trigger */}
      <div className="menubar-left" ref={menuRef}>
        <button
          className={`menubar-item ${fileMenuOpen ? 'active' : ''}`}
          onClick={() => setFileMenuOpen(v => !v)}
        >
          File
        </button>

        {fileMenuOpen && (
          <div className="menubar-dropdown">
            {fileItems.map((item, i) =>
              item.separator ? (
                <div key={i} className="menu-separator" />
              ) : (
                <button
                  key={i}
                  className="menu-entry"
                  disabled={item.disabled}
                  onClick={item.onClick}
                >
                  <span className="menu-entry-label">{item.label}</span>
                  {item.shortcut && (
                    <span className="menu-entry-shortcut">{item.shortcut}</span>
                  )}
                </button>
              )
            )}
          </div>
        )}
      </div>

      {/* Breadcrumb: project / name */}
      <div className="menubar-breadcrumb">
        {projectName && (
          <>
            <span className="breadcrumb-project">{projectName}</span>
            <span className="breadcrumb-sep">/</span>
          </>
        )}
        <span className="breadcrumb-name">{workflowName || 'Untitled'}</span>
        {isModified && <span className="breadcrumb-dot" title="Unsaved changes">●</span>}
      </div>

      <div className="menubar-right">
        {onEditFiles && (
          <button className="menubar-edit-files" onClick={onEditFiles}>
            Edit Files
          </button>
        )}
      </div>
    </div>
  );
}

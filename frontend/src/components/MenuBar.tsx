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
  // Phase A.5 — workspace management
  /** Display name of the active workspace (basename of its absolute path). */
  workspaceName?: string;
  /** Recently-opened workspace paths, newest first. */
  recentWorkspaces?: { path: string; opened_at: string }[];
  /** Open a directory-picker and call the backend. */
  onOpenWorkspace?: () => void;
  /** Open the chosen recent workspace by absolute path. */
  onOpenRecentWorkspace?: (path: string) => void;
  /** Reset workspace back to the launch cwd (no-op in the backend, just clears UI state). */
  onCloseWorkspace?: () => void;
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
  workspaceName,
  recentWorkspaces = [],
  onOpenWorkspace,
  onOpenRecentWorkspace,
  onCloseWorkspace,
}: MenuBarProps) {
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [recentMenuOpen, setRecentMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!fileMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setFileMenuOpen(false);
        setRecentMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [fileMenuOpen]);

  const closeMenus = () => {
    setFileMenuOpen(false);
    setRecentMenuOpen(false);
  };

  const fileItems: MenuBarAction[] = [
    { label: 'New Pipeline',     shortcut: '⌘N',  onClick: () => { closeMenus(); onNew(); } },
    { label: '', separator: true, onClick: () => {} },
    { label: 'Save',             shortcut: '⌘S',  onClick: () => { closeMenus(); onSave(); } },
    { label: 'Save As…',         shortcut: '⇧⌘S', onClick: () => { closeMenus(); onSaveAs(); } },
    { label: 'Rename',                             onClick: () => { closeMenus(); onRename(); } },
  ];

  // Workspace-management section (Phase A.5).  Only shown if the host wired
  // at least one of the handlers.
  const showWorkspaceSection = onOpenWorkspace || onOpenRecentWorkspace || onCloseWorkspace;

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

            {showWorkspaceSection && <div className="menu-separator" />}

            {onOpenWorkspace && (
              <button
                className="menu-entry"
                onClick={() => { closeMenus(); onOpenWorkspace(); }}
              >
                <span className="menu-entry-label">Open Workspace…</span>
                <span className="menu-entry-shortcut">⌘⇧O</span>
              </button>
            )}

            {onOpenRecentWorkspace && recentWorkspaces.length > 0 && (
              <div
                className="menu-entry menu-entry-submenu"
                onMouseEnter={() => setRecentMenuOpen(true)}
                onMouseLeave={() => setRecentMenuOpen(false)}
                style={{ position: 'relative' }}
              >
                <span className="menu-entry-label">Open Recent</span>
                <span className="menu-entry-shortcut">▸</span>

                {recentMenuOpen && (
                  <div className="menubar-dropdown menubar-submenu">
                    {recentWorkspaces.slice(0, 10).map((r) => (
                      <button
                        key={r.path}
                        className="menu-entry"
                        onClick={() => { closeMenus(); onOpenRecentWorkspace(r.path); }}
                        title={r.path}
                      >
                        <span className="menu-entry-label menu-entry-recent">
                          <span className="recent-base">{r.path.split('/').pop() || r.path}</span>
                          <span className="recent-dir">{r.path.replace(/\/[^/]+$/, '') || '/'}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {onCloseWorkspace && workspaceName && (
              <button
                className="menu-entry"
                onClick={() => { closeMenus(); onCloseWorkspace(); }}
              >
                <span className="menu-entry-label">Close Workspace</span>
              </button>
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

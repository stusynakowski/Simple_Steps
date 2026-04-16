import React, { useState, useEffect, useCallback } from 'react';
import { fetchFileTree, fetchWorkspaceInfo } from '../services/api';
import type { FileEntry } from '../services/api';
import './FileTree.css';

// ── Icons ──────────────────────────────────────────────────────────────────

const FileIcon = ({ name }: { name: string }) => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  let color = '#ccc';
  if (['py'].includes(ext)) color = '#3572A5';
  else if (['ts', 'tsx'].includes(ext)) color = '#3178c6';
  else if (['js', 'jsx'].includes(ext)) color = '#f1e05a';
  else if (['json'].includes(ext)) color = '#a8744a';
  else if (['md'].includes(ext)) color = '#519aba';
  else if (['css', 'scss'].includes(ext)) color = '#c76494';
  else if (['html'].includes(ext)) color = '#e34c26';
  else if (['toml', 'yaml', 'yml', 'cfg', 'ini'].includes(ext)) color = '#888';
  else if (['sh', 'bash', 'zsh'].includes(ext)) color = '#89e051';

  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0 }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  );
};

const DirChevron = ({ open }: { open: boolean }) => (
  <span style={{
    display: 'inline-block', fontSize: '0.55rem', width: 10, textAlign: 'center',
    transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
    transition: 'transform 0.12s',
    color: '#ccc',
  }}>▼</span>
);

const FolderIcon = ({ open }: { open: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="#dcb67a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0 }}>
    {open
      ? <><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="2" y1="10" x2="22" y2="10"/></>
      : <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>}
  </svg>
);

// ── Directory node (lazy-loaded) ───────────────────────────────────────────

interface DirNodeProps {
  entry: FileEntry;
  depth: number;
  onFileClick?: (path: string) => void;
}

const DirNode: React.FC<DirNodeProps> = ({ entry, depth, onFileClick }) => {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = useCallback(async () => {
    if (!open && children === null) {
      setLoading(true);
      try {
        const res = await fetchFileTree(entry.path);
        setChildren(res.entries);
      } catch {
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
    setOpen(o => !o);
  }, [open, children, entry.path]);

  return (
    <div>
      <div
        className="filetree-row"
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={toggle}
      >
        <DirChevron open={open} />
        <FolderIcon open={open} />
        <span className="filetree-label">{entry.name}</span>
      </div>
      {open && (
        <div>
          {loading && (
            <div className="filetree-row" style={{ paddingLeft: 8 + (depth + 1) * 16, color: '#666', fontSize: '0.75rem' }}>
              Loading…
            </div>
          )}
          {children?.map(child =>
            child.type === 'directory'
              ? <DirNode key={child.path} entry={child} depth={depth + 1} onFileClick={onFileClick} />
              : <FileNode key={child.path} entry={child} depth={depth + 1} onClick={onFileClick} />
          )}
        </div>
      )}
    </div>
  );
};

// ── File node ──────────────────────────────────────────────────────────────

interface FileNodeProps {
  entry: FileEntry;
  depth: number;
  onClick?: (path: string) => void;
}

const FileNode: React.FC<FileNodeProps> = ({ entry, depth, onClick }) => (
  <div
    className="filetree-row filetree-file"
    style={{ paddingLeft: 8 + depth * 16 + 10 /* extra indent = no chevron */ }}
    onClick={() => onClick?.(entry.path)}
    title={entry.path}
  >
    <FileIcon name={entry.name} />
    <span className="filetree-label">{entry.name}</span>
  </div>
);

// ── Root component ─────────────────────────────────────────────────────────

interface FileTreeProps {
  onFileClick?: (path: string) => void;
}

const FileTree: React.FC<FileTreeProps> = ({ onFileClick }) => {
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const [workspaceName, setWorkspaceName] = useState('WORKSPACE');
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [tree, info] = await Promise.all([
          fetchFileTree(''),
          fetchWorkspaceInfo(),
        ]);
        setRootEntries(tree.entries);
        // Show just the folder name, not the full path
        const parts = info.workspace_root.split('/');
        setWorkspaceName(parts[parts.length - 1] || 'WORKSPACE');
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="filetree-root">
      <div className="sidebar-section">
        <div
          className={`sidebar-section-title ${!open ? 'collapsed' : ''}`}
          onClick={() => setOpen(o => !o)}
        >
          <span className={`chevron ${!open ? 'collapsed' : ''}`}>▼</span>
          <span>{workspaceName.toUpperCase()}</span>
        </div>

        {open && (
          <div className="filetree-entries">
            {loading && <div style={{ padding: '6px 16px', color: '#888', fontSize: '0.8rem' }}>Loading…</div>}
            {!loading && rootEntries.length === 0 && (
              <div style={{ padding: '6px 16px', color: '#888', fontSize: '0.8rem' }}>Empty directory</div>
            )}
            {rootEntries.map(entry =>
              entry.type === 'directory'
                ? <DirNode key={entry.path} entry={entry} depth={0} onFileClick={onFileClick} />
                : <FileNode key={entry.path} entry={entry} depth={0} onClick={onFileClick} />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default FileTree;

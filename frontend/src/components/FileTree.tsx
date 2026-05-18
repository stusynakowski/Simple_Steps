import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Tree, type NodeApi, type NodeRendererProps } from 'react-arborist';
import { fetchFileTree, fetchWorkspaceInfo } from '../services/api';
import type { FileEntry } from '../services/api';
import Icon from './Icon';
import './FileTree.css';

// ── Tree data model ────────────────────────────────────────────────────────
// react-arborist expects each node to have an `id` and (for directories) a
// `children` array. We use `children: undefined` to mean "not yet loaded"
// and `children: []` to mean "loaded, empty".

interface TreeNode {
  id: string;          // path (unique)
  name: string;
  type: 'file' | 'directory';
  /** Phase A.3 — set to 'pipeline' for workflow files under projects/. */
  kind?: 'file' | 'directory' | 'pipeline';
  children?: TreeNode[];
}

const toNode = (e: FileEntry): TreeNode => ({
  id: e.path,
  name: e.name,
  type: e.type,
  kind: e.kind,
  children: e.type === 'directory' ? undefined : undefined,
});

// Recursively patch a node's children inside a tree (immutably).
function patchChildren(nodes: TreeNode[], id: string, children: TreeNode[]): TreeNode[] {
  return nodes.map(n => {
    if (n.id === id) return { ...n, children };
    if (n.children && n.children.length) {
      return { ...n, children: patchChildren(n.children, id, children) };
    }
    return n;
  });
}

// ── File / folder icons via codicons ───────────────────────────────────────

function extIconName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  // codicons are sparse for file types; map a few, fall back to `file`.
  if (['py'].includes(ext)) return 'symbol-namespace';
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) return 'symbol-method';
  if (['json'].includes(ext)) return 'json';
  if (['md', 'markdown'].includes(ext)) return 'markdown';
  if (['css', 'scss', 'sass'].includes(ext)) return 'symbol-color';
  if (['html', 'htm'].includes(ext)) return 'code';
  if (['toml', 'yaml', 'yml', 'cfg', 'ini'].includes(ext)) return 'settings-gear';
  if (['sh', 'bash', 'zsh'].includes(ext)) return 'terminal';
  return 'file';
}

// ── Node renderer ──────────────────────────────────────────────────────────

function Node({ node, style, dragHandle, onPipelineOpen }: NodeRendererProps<TreeNode> & { onPipelineOpen?: (path: string) => void }) {
  const isDir = node.data.type === 'directory';
  const isPipeline = node.data.kind === 'pipeline';
  const isOpen = node.isOpen;

  return (
    <div
      ref={dragHandle}
      className={`filetree-row ${node.isSelected ? 'selected' : ''} ${isDir ? '' : 'filetree-file'} ${isPipeline ? 'filetree-pipeline' : ''}`}
      style={style}
      onClick={() => {
        if (isDir) node.toggle();
        else node.select();
      }}
      onDoubleClick={() => {
        if (isPipeline) onPipelineOpen?.(node.data.id);
      }}
      title={node.data.id}
    >
      {isDir ? (
        <Icon
          name={isOpen ? 'chevron-down' : 'chevron-right'}
          size={12}
          color="#ccc"
        />
      ) : (
        <span style={{ display: 'inline-block', width: 12 }} />
      )}
      <Icon
        name={
          isDir
            ? isOpen ? 'folder-opened' : 'folder'
            : isPipeline ? 'notebook'
            : extIconName(node.data.name)
        }
        size={14}
        color={isDir ? '#dcb67a' : isPipeline ? '#4ec9b0' : undefined}
      />
      <span className="filetree-label">{node.data.name}</span>
    </div>
  );
}

// ── Root component ─────────────────────────────────────────────────────────

interface FileTreeProps {
  onFileClick?: (path: string) => void;
  /** Phase A.4 — fired on double-click of a pipeline file (workflow JSON
   *  under projects/).  The host opens it in a new workflow tab. */
  onPipelineOpen?: (path: string) => void;
}

const FileTree: React.FC<FileTreeProps> = ({ onFileClick, onPipelineOpen }) => {
  const [data, setData] = useState<TreeNode[]>([]);
  const [workspaceName, setWorkspaceName] = useState('WORKSPACE');
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [height, setHeight] = useState(400);
  const containerRef = useRef<HTMLDivElement>(null);

  // Initial load: root entries + workspace name.
  useEffect(() => {
    (async () => {
      try {
        const [tree, info] = await Promise.all([
          fetchFileTree(''),
          fetchWorkspaceInfo(),
        ]);
        setData(tree.entries.map(toNode));
        const parts = info.workspace_root.split('/');
        setWorkspaceName(parts[parts.length - 1] || 'WORKSPACE');
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Track container height for the virtualized Tree.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setHeight(Math.max(120, entry.contentRect.height));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  // Lazy load on directory toggle.
  const handleToggle = useCallback(async (id: string) => {
    // Walk the tree to find the node and check if children are loaded.
    const findNode = (nodes: TreeNode[]): TreeNode | null => {
      for (const n of nodes) {
        if (n.id === id) return n;
        if (n.children) {
          const f = findNode(n.children);
          if (f) return f;
        }
      }
      return null;
    };
    const node = findNode(data);
    if (!node || node.type !== 'directory' || node.children !== undefined) return;
    try {
      const res = await fetchFileTree(id);
      setData(prev => patchChildren(prev, id, res.entries.map(toNode)));
    } catch {
      setData(prev => patchChildren(prev, id, []));
    }
  }, [data]);

  const handleSelect = useCallback((nodes: NodeApi<TreeNode>[]) => {
    const n = nodes[0];
    if (n && n.data.type === 'file') onFileClick?.(n.data.id);
  }, [onFileClick]);

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
          <div className="filetree-entries" ref={containerRef}>
            {loading && (
              <div style={{ padding: '6px 16px', color: '#888', fontSize: '0.8rem' }}>
                Loading…
              </div>
            )}
            {!loading && data.length === 0 && (
              <div style={{ padding: '6px 16px', color: '#888', fontSize: '0.8rem' }}>
                Empty directory
              </div>
            )}
            {!loading && data.length > 0 && (
              <Tree<TreeNode>
                data={data}
                openByDefault={false}
                width="100%"
                height={height}
                indent={16}
                rowHeight={22}
                onToggle={handleToggle}
                onSelect={handleSelect}
                disableDrag
                disableDrop
              >
                {(props) => <Node {...props} onPipelineOpen={onPipelineOpen} />}
              </Tree>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default FileTree;

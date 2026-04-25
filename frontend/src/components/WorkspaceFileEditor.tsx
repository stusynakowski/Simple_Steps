import { useCallback, useEffect, useMemo, useState } from 'react';
import FileTree from './FileTree';
import { readWorkspaceFile, writeWorkspaceFile } from '../services/api';
import './WorkspaceFileEditor.css';

interface WorkspaceFileEditorProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function WorkspaceFileEditor({ isOpen, onClose }: WorkspaceFileEditorProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const hasUnsavedChanges = useMemo(
    () => selectedPath !== null && content !== originalContent,
    [selectedPath, content, originalContent],
  );

  const handleOpenFile = useCallback(async (path: string) => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm('You have unsaved changes. Switch files without saving?');
      if (!confirmed) return;
    }
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const result = await readWorkspaceFile(path);
      if (result.content === null) {
        setSelectedPath(path);
        setContent('');
        setOriginalContent('');
        setError('File is too large to edit in-app.');
        return;
      }
      setSelectedPath(path);
      setContent(result.content);
      setOriginalContent(result.content);
    } catch (err) {
      setSelectedPath(path);
      setContent('');
      setOriginalContent('');
      setError(err instanceof Error ? err.message : 'Could not load file');
    } finally {
      setLoading(false);
    }
  }, [hasUnsavedChanges]);

  const handleSave = useCallback(async () => {
    if (!selectedPath) return;
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      await writeWorkspaceFile(selectedPath, content);
      setOriginalContent(content);
      setStatus('Saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save file');
    } finally {
      setSaving(false);
    }
  }, [selectedPath, content]);

  const handleRequestClose = useCallback(() => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm('You have unsaved changes. Close without saving?');
      if (!confirmed) return;
    }
    onClose();
  }, [hasUnsavedChanges, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setStatus(null);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="workspace-editor-overlay">
      <div className="workspace-editor-panel">
        <div className="workspace-editor-header">
          <div className="workspace-editor-title">Project File Editor</div>
          <button className="workspace-editor-close" onClick={handleRequestClose}>✕</button>
        </div>

        <div className="workspace-editor-body">
          <div className="workspace-editor-tree">
            <FileTree onFileClick={handleOpenFile} />
          </div>

          <div className="workspace-editor-main">
            <div className="workspace-editor-path">
              {selectedPath ?? 'Select a file from the left to start editing'}
            </div>

            {selectedPath ? (
              <textarea
                className="workspace-editor-textarea"
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="File content"
                disabled={loading || saving}
              />
            ) : (
              <div className="workspace-editor-empty">Open a file to view and edit function code.</div>
            )}
          </div>
        </div>

        <div className="workspace-editor-footer">
          <div className={`workspace-editor-status ${error ? 'error' : ''}`}>
            {error ?? status ?? (hasUnsavedChanges ? 'Unsaved changes' : '')}
          </div>
          <button
            className="workspace-editor-save"
            onClick={handleSave}
            disabled={!selectedPath || !hasUnsavedChanges || loading || saving || Boolean(error && content.length === 0)}
          >
            {saving ? 'Saving…' : 'Save File'}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import type { ProjectInfo } from '../services/api';
import './SaveModal.css';

interface SaveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (projectId: string, pipelineName: string, projectDisplayName: string) => Promise<void>;
  onCreateProject: (name: string) => Promise<ProjectInfo>;
  onListProjects: () => Promise<ProjectInfo[]>;
  defaultName?: string;
  title?: string;
  /** Pre-select this project when the modal opens (from sidebar 💾 click) */
  preselectProjectId?: string;
}

export default function SaveModal({
  isOpen, onClose, onSave, onCreateProject, onListProjects,
  defaultName = 'my-pipeline', title = 'Save Pipeline', preselectProjectId,
}: SaveModalProps) {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [pipelineName, setPipelineName] = useState(defaultName);
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewProject, setShowNewProject] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setPipelineName(defaultName);
    setError('');
    setShowNewProject(false);
    setNewProjectName('');
    onListProjects()
      .then(list => {
        setProjects(list);
        // Pre-select the requested project if provided, else first in list
        if (preselectProjectId && list.find(p => p.id === preselectProjectId)) {
          setSelectedProjectId(preselectProjectId);
        } else if (list.length > 0) {
          setSelectedProjectId(list[0].id);
        } else {
          setSelectedProjectId(''); setShowNewProject(true);
        }
      })
      .catch(() => setError('Could not load projects'));
  }, [isOpen, defaultName, onListProjects, preselectProjectId]);

  if (!isOpen) return null;

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    try {
      const proj = await onCreateProject(newProjectName.trim());
      const updated = await onListProjects();
      setProjects(updated);
      setSelectedProjectId(proj.id);
      setShowNewProject(false);
      setNewProjectName('');
    } catch {
      setError('Failed to create project');
    }
  };

  const handleSave = async () => {
    if (!selectedProjectId) { setError('Select or create a project first'); return; }
    if (!pipelineName.trim()) { setError('Pipeline name cannot be empty'); return; }
    setSaving(true);
    setError('');
    try {
      const proj = projects.find(p => p.id === selectedProjectId);
      await onSave(selectedProjectId, pipelineName.trim(), proj?.name ?? selectedProjectId);
      onClose();
    } catch {
      setError('Save failed — is the backend running?');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* Pipeline name */}
          <div className="modal-field">
            <label className="modal-label">Pipeline name</label>
            <input
              className="modal-input"
              value={pipelineName}
              onChange={e => setPipelineName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              autoFocus
              placeholder="e.g. youtube-analysis"
            />
          </div>

          {/* Project picker */}
          <div className="modal-field">
            <label className="modal-label">Project folder</label>
            {projects.length > 0 && !showNewProject ? (
              <div className="modal-project-row">
                <select
                  className="modal-select"
                  value={selectedProjectId}
                  onChange={e => setSelectedProjectId(e.target.value)}
                >
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button className="modal-new-btn" onClick={() => setShowNewProject(true)}>
                  + New folder
                </button>
              </div>
            ) : (
              <div className="modal-project-row">
                <input
                  className="modal-input"
                  placeholder="New project folder name…"
                  value={newProjectName}
                  onChange={e => setNewProjectName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateProject()}
                />
                <button className="modal-confirm-btn" onClick={handleCreateProject}>
                  Create
                </button>
                {projects.length > 0 && (
                  <button className="modal-new-btn" onClick={() => setShowNewProject(false)}>
                    Cancel
                  </button>
                )}
              </div>
            )}
          </div>

          {error && <div className="modal-error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="modal-cancel-btn" onClick={onClose}>Cancel</button>
          <button className="modal-save-btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

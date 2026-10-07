import { useEffect, useRef, useState } from 'react';
import type { Step } from '../types/models';
import {
  fetchResourceTypes,
  type ResourceDeclaration,
  type ResourceTypeInfo,
} from '../services/api';
import { definitionText, pyLiteral, stepsUsingResource } from '../utils/resources';

/**
 * The workflow toolbar's Resources menu (docs/dev_plan/122 §2.4).
 *
 * A resource belongs to the workflow, never to a step, so it is created and
 * changed here, in formula syntax (`FakeLLM(model="fake-1")`), and steps only
 * *use* it with `res["name"]`. Every change goes through `onDefine` /
 * `onRemove`, the same mutators the console's `res["x"] = …` / `del res["x"]`
 * reach, so the two can't drift.
 */

interface ResourcesMenuProps {
  resources: Record<string, unknown> | undefined;
  steps: Step[];
  onDefine: (name: string, definition: string) => Promise<void>;
  onRemove: (name: string) => void;
}

/** A type's settings with their defaults, as a starting definition. */
function templateFor(info: ResourceTypeInfo): string {
  const settings = info.settings
    .map((s) => `${s.name}=${s.required ? '' : pyLiteral(s.default)}`)
    .join(', ');
  return `${info.type}(${settings})`;
}

export default function ResourcesMenu({ resources, steps, onDefine, onRemove }: ResourcesMenuProps) {
  const [open, setOpen] = useState(false);
  const [types, setTypes] = useState<Record<string, ResourceTypeInfo>>({});
  const [editing, setEditing] = useState<string | null>(null);   // a name, or '' for new
  const [name, setName] = useState('');
  const [definition, setDefinition] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const entries = Object.entries(resources ?? {}) as [string, ResourceDeclaration][];
  // A resource whose type this app doesn't offer can't run: flag it on the button.
  const unavailable = entries.filter(([, d]) => Object.keys(types).length > 0 && !(d.type in types));

  useEffect(() => {
    fetchResourceTypes().then(setTypes).catch(() => setTypes({}));
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const startEdit = (target: string | null, decl?: ResourceDeclaration) => {
    setError(null);
    setEditing(target);
    setName(target ?? '');
    setDefinition(decl ? definitionText(decl) : '');
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDefine(name, definition);
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = (target: string) => {
    setError(null);
    try {
      onRemove(target);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); void save(); }
    if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); setError(null); }
  };

  const editor = (
    <div className="ut-resource-editor">
      {editing === '' && (
        <input
          className="ut-resource-input"
          placeholder="name, e.g. llm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKey}
          autoFocus
        />
      )}
      <input
        className="ut-resource-input ut-resource-mono"
        placeholder={'Type(setting=…), e.g. FakeLLM(model="fake-1")'}
        value={definition}
        onChange={(e) => setDefinition(e.target.value)}
        onKeyDown={onKey}
        autoFocus={editing !== ''}
      />
      {editing === '' && Object.keys(types).length > 0 && (
        <div className="ut-resource-types">
          {Object.values(types).map((info) => (
            <button
              key={info.type}
              className="ut-resource-type"
              title={info.description || info.type}
              onClick={() => setDefinition(templateFor(info))}
            >
              {info.type}
            </button>
          ))}
        </div>
      )}
      <div className="ut-resource-actions">
        <button className="ut-btn" onClick={() => { setEditing(null); setError(null); }}>Cancel</button>
        <button className="ut-btn ut-btn-run" onClick={() => void save()} disabled={busy || !name || !definition}>
          {editing === '' ? 'Add' : 'Save'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="ut-group" ref={rootRef}>
      <button
        className={`ut-dropdown-trigger ${open ? 'active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={'This workflow\'s resources: objects steps use with res["name"]'}
      >
        <span>Resources</span>
        <span className="ut-badge">{entries.length}</span>
        {unavailable.length > 0 && <span className="ut-error-dot" title="A resource needs attention" />}
        <span className="ut-caret">▾</span>
      </button>

      {open && (
        <div className="ut-dropdown-panel ut-resources-panel">
          <div className="ut-panel-title">Resources in this workflow</div>

          {entries.length === 0 && editing === null && (
            <div className="ut-empty">None yet. Steps use a resource with res["name"].</div>
          )}

          <div className="ut-resource-list">
            {entries.map(([resName, decl]) => {
              const users = stepsUsingResource(steps, resName);
              const missing = Object.keys(types).length > 0 && !(decl.type in types);
              const loaded = decl.source === 'loaded';
              if (editing === resName) {
                return (
                  <div key={resName} className="ut-resource-row ut-resource-editing">
                    <span className="ut-resource-name">{resName}</span>
                    {editor}
                  </div>
                );
              }
              return (
                <div key={resName} className="ut-resource-row">
                  <span
                    className={`ut-resource-dot ${missing ? 'missing' : ''}`}
                    title={missing ? `This app has no resource type ${decl.type}` : 'Available'}
                  />
                  <span className="ut-resource-name">
                    {loaded && <span title="Provided by the deployment">🔒 </span>}
                    {resName}
                    <span className="ut-resource-mono ut-resource-def">{definitionText(decl)}</span>
                    <span className="ut-resource-meta">
                      {users.length ? `used by ${users.join(', ')}` : 'not used yet'}
                    </span>
                  </span>
                  {!loaded && (
                    <button className="ut-resource-edit" title="Change settings" onClick={() => startEdit(resName, decl)}>
                      ✎
                    </button>
                  )}
                  <button
                    className="ut-resource-remove"
                    title={users.length ? `Used by ${users.join(', ')}` : 'Delete'}
                    onClick={() => remove(resName)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          {editing === '' ? editor : (
            <button className="ut-resource-add-btn" onClick={() => startEdit('')}>+ New resource</button>
          )}

          {error && <div className="ut-resource-error">{error}</div>}
        </div>
      )}
    </div>
  );
}

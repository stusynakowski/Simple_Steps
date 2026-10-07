import { useEffect, useRef, useState } from 'react';
import type { Step } from '../types/models';
import {
  fetchLoadedResources,
  fetchResourceTypes,
  type LoadedResourceInfo,
  type ResourceDeclaration,
  type ResourceTypeInfo,
} from '../services/api';
import {
  definitionText,
  loadedProblem,
  pyLiteral,
  stepsUsingResource,
} from '../utils/resources';

/**
 * The workflow toolbar's Resources menu (docs/dev_plan/122 §2.4).
 *
 * A resource belongs to the workflow, never to a step, so it is created and
 * changed here, in formula syntax (`FakeLLM(model="fake-1")`), and steps only
 * *use* it with `res["name"]`. Every change goes through `onDefine` /
 * `onRemove`, the same mutators the console's `res["x"] = …` / `del res["x"]`
 * reach, so the two can't drift.
 *
 * Two kinds of resource (122 §2.4a):
 * - **defined** — the workflow's own, built from its saved settings;
 * - **ready-made** — provided by the deployment. "Use" adds one to the
 *   workflow; editing it saves only what changed (the backend works out the
 *   overrides), and settings the deployment locked or reads from the
 *   environment can't be changed. One the deployment doesn't provide here, or
 *   whose settings changed since the workflow was saved, is flagged.
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
  const [loaded, setLoaded] = useState<Record<string, LoadedResourceInfo>>({});
  const [editing, setEditing] = useState<string | null>(null);   // a name, or '' for new
  const [name, setName] = useState('');
  const [definition, setDefinition] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const entries = Object.entries(resources ?? {}) as [string, ResourceDeclaration][];
  const typesKnown = Object.keys(types).length > 0;
  const missingType = (d: ResourceDeclaration) => typesKnown && !(d.type in types);
  // Anything that would stop a step running, or changed under the user: flag the button.
  const needsAttention = entries.some(([n, d]) => missingType(d) || loadedProblem(d, loaded[n]) !== null);
  const unused = Object.entries(loaded).filter(([n]) => !(resources && n in resources));

  useEffect(() => {
    fetchResourceTypes().then(setTypes).catch(() => setTypes({}));
    fetchLoadedResources().then(setLoaded).catch(() => setLoaded({}));
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
    setDefinition(decl ? definitionText(decl, target ? loaded[target] : undefined) : '');
  };

  const define = async (target: string, text: string) => {
    setBusy(true);
    setError(null);
    try {
      await onDefine(target, text);
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
    if (e.key === 'Enter') { e.preventDefault(); void define(name, definition); }
    if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); setError(null); }
  };

  const lockedNote = (target: string) => {
    const info = loaded[target];
    if (!info || info.locked.length === 0) return null;
    const fromEnv = Object.entries(info.from_env).map(([k, ptr]) => `${k} (${ptr})`);
    const others = info.locked.filter((k) => !(k in info.from_env));
    return (
      <div className="ut-resource-meta">
        Set by the deployment: {[...others, ...fromEnv].join(', ')}
      </div>
    );
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
      {editing && lockedNote(editing)}
      {editing === '' && typesKnown && (
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
        <button
          className="ut-btn ut-btn-run"
          onClick={() => void define(name, definition)}
          disabled={busy || !name || !definition}
        >
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
        {needsAttention && <span className="ut-error-dot" title="A resource needs attention" />}
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
              const info = loaded[resName];
              const isLoaded = decl.source === 'loaded';
              const problem = loadedProblem(decl, info);
              const overrides = Object.entries((decl.overrides as Record<string, unknown>) ?? {});
              const bad = missingType(decl) || problem?.kind === 'missing';
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
                    className={`ut-resource-dot ${bad ? 'missing' : problem ? 'changed' : ''}`}
                    title={
                      missingType(decl) ? `This app has no resource type ${decl.type}`
                        : problem ? problem.detail : 'Available'
                    }
                  />
                  <span className="ut-resource-name">
                    <span>
                      {resName}
                      {isLoaded && <span className="ut-resource-tag" title="Provided by the deployment">ready-made</span>}
                    </span>
                    <span className="ut-resource-mono ut-resource-def">{definitionText(decl, info)}</span>
                    {overrides.length > 0 && (
                      <span className="ut-resource-meta">
                        changed: {overrides.map(([k, v]) => `${k}=${pyLiteral(v)}`).join(', ')}
                      </span>
                    )}
                    {problem && (
                      <span className={`ut-resource-meta ${problem.kind === 'missing' ? 'ut-resource-bad' : 'ut-resource-warn'}`}>
                        {problem.detail}
                        {problem.kind === 'changed' && (
                          <button
                            className="ut-resource-link"
                            onClick={() => void define(resName, definitionText(decl, info))}
                            title="Save the deployment's current settings as this workflow's"
                          >
                            Accept
                          </button>
                        )}
                      </span>
                    )}
                    <span className="ut-resource-meta">
                      {users.length ? `used by ${users.join(', ')}` : 'not used yet'}
                    </span>
                  </span>
                  {!(isLoaded && !info) && (
                    <button className="ut-resource-edit" title="Change settings" onClick={() => startEdit(resName, decl)}>
                      ✎
                    </button>
                  )}
                  <button
                    className="ut-resource-remove"
                    title={users.length ? `Used by ${users.join(', ')}` : 'Remove from this workflow'}
                    onClick={() => remove(resName)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          {unused.length > 0 && (
            <>
              <div className="ut-panel-title ut-resource-subtitle">From the deployment</div>
              <div className="ut-resource-list">
                {unused.map(([resName, info]) => (
                  <div key={resName} className="ut-resource-row">
                    <span className="ut-resource-dot" />
                    <span className="ut-resource-name">
                      <span>{resName}</span>
                      <span className="ut-resource-mono ut-resource-def">
                        {definitionText({ source: 'defined', type: info.type, settings: info.settings })}
                      </span>
                    </span>
                    <button
                      className="ut-resource-link"
                      title={`Add res["${resName}"] to this workflow`}
                      onClick={() => void define(resName,
                        definitionText({ source: 'defined', type: info.type, settings: info.settings }))}
                    >
                      Use
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {editing === '' ? editor : (
            <button className="ut-resource-add-btn" onClick={() => startEdit('')}>+ New resource</button>
          )}

          {error && <div className="ut-resource-error">{error}</div>}
        </div>
      )}
    </div>
  );
}

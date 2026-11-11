import { useEffect, useState, type RefObject } from 'react';
import Markdown from 'react-markdown';
import type { Step } from '../types/models';
import type { LoadedResourceInfo, ResourceDeclaration, ResourceTypeInfo } from '../services/api';
import { definitionText, pyLiteral, stepsUsingResource } from '../utils/resources';
import { needsAttention, STATUS_TEXT, type ResourceState, type ResourceStatus } from '../hooks/useResourceState';
import StepMenu from './StepMenu';
import SymbolIcon from './SymbolIcon';
import './ResourceColumn.css';

/**
 * The resource column (spec 017): the workflow's resources, ahead of step 1.
 *
 * A header ("Resources") opens a list of one header per resource; a
 * resource's header opens its panel — Load / Refresh / Clear, its status, the
 * formula that defines it, the steps that use it. Several can be open at
 * once, stacked. Pinned, a thin view stays at the left edge while the steps
 * scroll; scrolled back to the start, the full column shows again.
 *
 * Every change goes through `onDefine` / `onRemove` (as the console's
 * `res["x"] = …` does) and `onMeta` (notes, colour).
 */

interface ResourceColumnProps {
  resources: Record<string, unknown> | undefined;
  steps: Step[];
  state: ResourceState;
  /** A step's colour, by label, for the "used by" chips. */
  stepColorOf: (label: string) => string;
  onDefine: (name: string, definition: string) => Promise<void>;
  onRemove: (name: string) => void;
  onMeta: (name: string, changes: { notes?: string; color?: string }) => void;
  /** The steps to highlight while a resource is hovered, or null. */
  onHighlight: (labels: string[] | null) => void;
  /** The steps' horizontal scroller, for the pinned thin view. */
  scroller: RefObject<HTMLElement | null>;
}

const DEFAULT_COLOR = '#5b6b7f';
const PIN_KEY = 'simple-steps.resources.pinned';

function readPinned(): boolean {
  try { return localStorage.getItem(PIN_KEY) === '1'; } catch { return false; }
}
function writePinned(on: boolean) {
  try { localStorage.setItem(PIN_KEY, on ? '1' : '0'); } catch { /* per-viewer nicety only */ }
}

function metaOf(decl: unknown): { notes?: string; color?: string } {
  return ((decl as { meta?: Record<string, string> } | undefined)?.meta) ?? {};
}

function templateFor(info: ResourceTypeInfo): string {
  const settings = info.settings
    .map((s) => `${s.name}=${s.required ? '' : pyLiteral(s.default)}`)
    .join(', ');
  return `${info.type}(${settings})`;
}

function StatusDot({ status }: { status: ResourceStatus }) {
  return <span className={`rc-dot rc-dot--${status.kind}`} title={`${STATUS_TEXT[status.kind]}: ${status.detail}`} />;
}

export default function ResourceColumn(props: ResourceColumnProps) {
  const { resources, steps, state, scroller } = props;
  const entries = Object.entries(resources ?? {}) as [string, ResourceDeclaration][];
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [listOpen, setListOpen] = useState(true);
  const [openNames, setOpenNames] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [pinned, setPinned] = useState(readPinned);
  const [scrolled, setScrolled] = useState(false);

  // Pinned: the thin view shows once the steps scroll off the start.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !pinned) return;   // unpinned, `thin` is off whatever `scrolled` says
    const on = () => setScrolled(el.scrollLeft > 4);
    on();
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, [pinned, scroller]);

  const togglePin = () => { setPinned((p) => { writePinned(!p); return !p; }); };
  const toggleOpen = (name: string) => setOpenNames((s) => {
    const next = new Set(s);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const attention = entries.some(([n]) => needsAttention(state.statusOf(n)));
  const unused = Object.entries(state.loaded).filter(([n]) => !(resources && n in resources));
  const wide = listOpen && (openNames.size > 0 || adding);

  const thin = pinned && scrolled && (
    <div className="rc-thin" aria-label="Resources (pinned)">
      <button
        type="button"
        className="rc-thin-head"
        title="Resources: back to the start of the workflow"
        onClick={() => scroller.current?.scrollTo({ left: 0, behavior: 'smooth' })}
      >
        <SymbolIcon name="database" size={16} />
        {attention && <span className="rc-attention" />}
      </button>
      {entries.map(([name, decl]) => (
        <button
          key={name}
          type="button"
          className="rc-thin-item"
          style={{ '--res-color': metaOf(decl).color ?? DEFAULT_COLOR } as React.CSSProperties}
          title={`${name}: ${STATUS_TEXT[state.statusOf(name).kind]}`}
          onMouseEnter={() => props.onHighlight(stepsUsingResource(steps, name))}
          onMouseLeave={() => props.onHighlight(null)}
          onClick={() => {
            setSideCollapsed(false); setListOpen(true);
            setOpenNames((s) => new Set(s).add(name));
            scroller.current?.scrollTo({ left: 0, behavior: 'smooth' });
          }}
        >
          <StatusDot status={state.statusOf(name)} />
          <span className="rc-thin-name">{name.slice(0, 3)}</span>
        </button>
      ))}
    </div>
  );

  if (sideCollapsed) {
    return (
      <>
        {thin}
        <div className="resource-column rc-collapsed" data-testid="resource-column">
          <button type="button" className="rc-strip" title="Show the resources" onClick={() => setSideCollapsed(false)}>
            <SymbolIcon name="database" size={16} />
            <span className="rc-count">{entries.length}</span>
            {attention && <span className="rc-attention" />}
          </button>
        </div>
        <div className="rc-divider" aria-hidden="true" />
      </>
    );
  }

  return (
    <>
      {thin}
      <div className={`resource-column${wide ? ' rc-wide' : ''}`} data-testid="resource-column">
        <div className="rc-head" onClick={() => setListOpen((v) => !v)} role="button" aria-expanded={listOpen}>
          <SymbolIcon name="database" size={16} />
          <span className="rc-head-title">Resources</span>
          <span className="rc-count">{entries.length}</span>
          {attention && <span className="rc-attention" title="A resource needs attention" />}
          <span className="rc-head-controls" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={`rc-btn-icon${pinned ? ' on' : ''}`}
              title={pinned ? 'Unpin: scroll away with the steps' : 'Pin: keep a thin view at the left while the steps scroll'}
              aria-pressed={pinned}
              onClick={togglePin}
            >
              <SymbolIcon name={pinned ? 'push_pin' : 'keep_off'} size={13} />
            </button>
            <button type="button" className="rc-btn-icon" title="Collapse the resources" onClick={() => setSideCollapsed(true)}>
              <SymbolIcon name="minimize" size={13} />
            </button>
          </span>
        </div>

        {listOpen && (
          <div className="rc-list">
            {entries.length === 0 && !adding && (
              <div className="rc-empty">None yet. Steps use a resource with res["name"].</div>
            )}
            {entries.map(([name, decl]) => (
              <ResourceCard
                key={name}
                {...props}
                name={name}
                decl={decl}
                open={openNames.has(name)}
                onToggle={() => toggleOpen(name)}
                onRenamed={(to) => setOpenNames((s) => { const n = new Set(s); n.delete(name); n.add(to); return n; })}
              />
            ))}

            {unused.length > 0 && (
              <div className="rc-ready">
                <div className="rc-subtitle">From the deployment</div>
                {unused.map(([name, info]) => (
                  <div key={name} className="rc-ready-row">
                    <span className="rc-ready-name">{name}</span>
                    <button
                      type="button"
                      className="rc-link"
                      title={`Add res["${name}"] to this workflow`}
                      onClick={() => void props.onDefine(name,
                        definitionText({ source: 'defined', type: info.type, settings: info.settings }))}
                    >
                      Use
                    </button>
                  </div>
                ))}
              </div>
            )}

            {adding
              ? <NewResource types={state.types} onDefine={props.onDefine} onDone={(name) => {
                  setAdding(false);
                  if (name) setOpenNames((s) => new Set(s).add(name));
                }} />
              : (
                <button type="button" className="rc-add" onClick={() => setAdding(true)}>
                  <SymbolIcon name="add" size={14} /> Resource
                </button>
              )}
          </div>
        )}
      </div>
      <div className="rc-divider" aria-hidden="true" />
    </>
  );
}

// ── One resource ──────────────────────────────────────────────────────────

function ResourceCard({
  name, decl, open, onToggle, onRenamed, steps, state, stepColorOf, onDefine, onRemove, onMeta, onHighlight,
}: ResourceColumnProps & {
  name: string;
  decl: ResourceDeclaration;
  open: boolean;
  onToggle: () => void;
  onRenamed: (to: string) => void;
}) {
  const info: LoadedResourceInfo | undefined = state.loaded[name];
  const status = state.statusOf(name);
  const users = stepsUsingResource(steps, name);
  const meta = metaOf(decl);
  const color = meta.color ?? DEFAULT_COLOR;
  const saved = definitionText(decl, info);
  const [text, setText] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesEditing, setNotesEditing] = useState(false);
  const [rename, setRename] = useState(name);
  const busy = status.kind === 'busy';

  useEffect(() => { setText(saved); }, [saved]);
  useEffect(() => { setRename(name); }, [name]);

  const commit = async () => {
    if (text.trim() === saved) return;
    setError(null);
    try { await onDefine(name, text); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const doRename = async () => {
    const to = rename.trim();
    if (!to || to === name) { setRename(name); return; }
    setError(null);
    try {
      if (decl.source === 'loaded') throw new Error('A ready-made resource keeps the name the deployment gave it.');
      if (users.length) throw new Error(`res["${name}"] is used by ${users.join(', ')}. Change those steps first.`);
      await onDefine(to, saved);
      if (meta.notes || meta.color) onMeta(to, meta);
      onRemove(name);
      onRenamed(to);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRename(name);
    }
  };

  const remove = () => {
    setError(null);
    try { onRemove(name); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const fromEnv = info ? Object.entries(info.from_env).map(([k, ptr]) => `${k} (${ptr})`) : [];
  const locked = info ? [...info.locked.filter((k) => !(k in info.from_env)), ...fromEnv] : [];

  const settings = (
    <div className="rc-settings" onClick={(e) => e.stopPropagation()}>
      <label className="rc-field">
        <span>Name</span>
        <input
          value={rename}
          onChange={(e) => setRename(e.target.value)}
          onBlur={() => void doRename()}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRename(name); }}
        />
      </label>
      <div className="rc-field">
        <span>Color</span>
        <div className="rc-color-row">
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_COLOR}
                 onChange={(e) => onMeta(name, { color: e.target.value })} />
          {meta.color && <button type="button" className="rc-link" onClick={() => onMeta(name, { color: undefined })}>Reset</button>}
        </div>
      </div>
      <button type="button" className="rc-remove" onClick={remove}
              title={users.length ? `Used by ${users.join(', ')}` : 'Remove from this workflow'}>
        <SymbolIcon name="delete" size={13} /> Remove
      </button>
    </div>
  );

  return (
    <div
      className={`rc-card${open ? ' open' : ''}`}
      style={{ '--res-color': color } as React.CSSProperties}
      onMouseEnter={() => onHighlight(users)}
      onMouseLeave={() => onHighlight(null)}
      data-testid={`resource-${name}`}
    >
      <div className="rc-card-head" onClick={onToggle} role="button" aria-expanded={open}>
        <StatusDot status={status} />
        <span className="rc-card-name">{name}</span>
        {decl.source === 'loaded' && <span className="rc-tag" title="Provided by the deployment">ready-made</span>}
        {open && (
          <span className="rc-card-controls" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={`rc-btn-icon${notesOpen ? ' on' : ''}`}
              title={notesOpen ? 'Fold the notes' : meta.notes ? 'Show the notes' : 'Add notes'}
              onClick={() => { setNotesEditing(!notesOpen && !meta.notes); setNotesOpen(!notesOpen); }}
            >
              <SymbolIcon name="sticky_note_2" size={12} />
            </button>
            <StepMenu icon="tune" iconSize={13} label="Resource settings" className="rc-btn-icon" align="right">
              {settings}
            </StepMenu>
            <button type="button" className="rc-btn-icon" title="Minimize" onClick={onToggle}>
              <SymbolIcon name="minimize" size={12} />
            </button>
          </span>
        )}
      </div>

      {open && notesOpen && (
        <div className="rc-notes">
          {notesEditing ? (
            <textarea
              autoFocus
              rows={4}
              value={meta.notes ?? ''}
              placeholder="What is this resource for? Markdown."
              onChange={(e) => onMeta(name, { notes: e.target.value })}
              onBlur={() => { setNotesEditing(false); if (!meta.notes?.trim()) setNotesOpen(false); }}
              onKeyDown={(e) => { if (e.key === 'Escape') e.currentTarget.blur(); }}
            />
          ) : (
            <div className="rc-notes-body" onDoubleClick={() => setNotesEditing(true)} title="Double-click to edit">
              <Markdown>{meta.notes}</Markdown>
            </div>
          )}
        </div>
      )}

      {open && (
        <div className="rc-body">
          <div className="rc-toolbar">
            <button type="button" className="rc-btn rc-btn-primary" disabled={busy || status.kind === 'loaded'}
                    onClick={() => void state.act(name, 'load')} title="Build it now, in this session">
              <SymbolIcon name="play_arrow" size={14} /> Load
            </button>
            <button type="button" className="rc-btn" disabled={busy}
                    onClick={() => void state.act(name, 'refresh')} title="Build it again">
              <SymbolIcon name="refresh" size={13} /> Refresh
            </button>
            <button type="button" className="rc-btn" disabled={busy || status.kind !== 'loaded'}
                    onClick={() => void state.act(name, 'clear')} title="Drop the live object; the definition stays">
              <SymbolIcon name="cleaning_services" size={13} /> Clear
            </button>
            <span className={`rc-status rc-status--${status.kind}`} title={status.detail}>{STATUS_TEXT[status.kind]}</span>
          </div>

          <div className="rc-formula">
            <span className="rc-formula-label">=</span>
            <input
              className="rc-formula-input"
              aria-label={`${name}'s definition`}
              spellCheck={false}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => void commit()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void commit(); }
                if (e.key === 'Escape') { setText(saved); setError(null); }
              }}
            />
          </div>
          {locked.length > 0 && <div className="rc-meta">Set by the deployment: {locked.join(', ')}</div>}
          {status.kind !== 'loaded' && status.kind !== 'not_loaded' && status.kind !== 'busy' && (
            <div className={`rc-meta ${status.kind === 'changed' ? 'rc-warn' : 'rc-bad'}`}>
              {status.detail}
              {status.kind === 'changed' && (
                <button type="button" className="rc-link" onClick={() => void onDefine(name, saved)}
                        title="Save the deployment's current settings as this workflow's">Accept</button>
              )}
            </div>
          )}
          {error && <div className="rc-meta rc-bad">{error}</div>}

          <div className="rc-users">
            {users.length
              ? <>used by {users.map((u) => (
                  <span key={u} className="rc-chip" style={{ '--chip': stepColorOf(u) } as React.CSSProperties}>{u}</span>
                ))}</>
              : <span className="rc-meta">not used yet</span>}
          </div>

          {status.kind === 'loaded' && (
            <div className="rc-browse">Browse: a file system's tree or a database's tables will show here.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── A new resource ────────────────────────────────────────────────────────

function NewResource({ types, onDefine, onDone }: {
  types: Record<string, ResourceTypeInfo>;
  onDefine: (name: string, definition: string) => Promise<void>;
  onDone: (name: string | null) => void;
}) {
  const [name, setName] = useState('');
  const [definition, setDefinition] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setError(null);
    try { await onDefine(name, definition); onDone(name.trim()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); void add(); }
    if (e.key === 'Escape') onDone(null);
  };

  return (
    <div className="rc-card open rc-new">
      <div className="rc-body">
        <input className="rc-input" placeholder="name, e.g. llm" value={name} autoFocus
               onChange={(e) => setName(e.target.value)} onKeyDown={onKey} />
        <div className="rc-formula">
          <span className="rc-formula-label">=</span>
          <input className="rc-formula-input" placeholder={'Type(setting=…), e.g. FakeLLM(model="fake-1")'}
                 spellCheck={false} value={definition}
                 onChange={(e) => setDefinition(e.target.value)} onKeyDown={onKey} />
        </div>
        <div className="rc-types">
          {Object.values(types).map((info) => (
            <button key={info.type} type="button" className="rc-type" title={info.description || info.type}
                    onClick={() => setDefinition(templateFor(info))}>
              {info.type}
            </button>
          ))}
        </div>
        {error && <div className="rc-meta rc-bad">{error}</div>}
        <div className="rc-toolbar">
          <button type="button" className="rc-btn" onClick={() => onDone(null)}>Cancel</button>
          <button type="button" className="rc-btn rc-btn-primary" disabled={!name || !definition} onClick={() => void add()}>Add</button>
        </div>
      </div>
    </div>
  );
}

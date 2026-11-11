import { useEffect, useRef, useState, type RefObject } from 'react';
import Markdown from 'react-markdown';
import type { Step } from '../types/models';
import type { LoadedResourceInfo, ResourceDeclaration, ResourceTypeInfo } from '../services/api';
import { definitionText, pyLiteral, resourceKind, stepsUsingResource, type ResourceKind } from '../utils/resources';
import { needsAttention, STATUS_TEXT, type ResourceState, type ResourceStatus } from '../hooks/useResourceState';
import StepMenu from './StepMenu';
import SymbolIcon, { type SymbolName } from './SymbolIcon';
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
const WIDTH_KEY = 'simple-steps.resources.width';
/** The bar on the column's edge: click it to hide or show, drag it to resize. */
const RAIL = 28;
const MIN_WIDTH = 150;
/** Dragged narrower than this, the column hides. */
const HIDE_BELOW = 90;

// Per-viewer niceties only: storage can be missing or blocked.
function readPref(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writePref(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* ignore */ }
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

const KIND_ICON: Record<ResourceKind, SymbolName> = {
  llm: 'smart_toy', database: 'database', filesystem: 'folder',
  compute: 'memory', service: 'cloud', other: 'deployed_code',
};

/** The icon for a resource's kind, from its type and the type's bases. */
function kindIcon(type: string, types: Record<string, ResourceTypeInfo>): SymbolName {
  return KIND_ICON[resourceKind(type, types[type]?.bases)];
}

function StatusDot({ status }: { status: ResourceStatus }) {
  return <span className={`rc-dot rc-dot--${status.kind}`} title={`${STATUS_TEXT[status.kind]}: ${status.detail}`} />;
}

/**
 * The bar on the column's right edge, "Resources" written down it. Hidden, the
 * column is this bar alone, with an icon per resource; with no resources, just
 * the word. Pinned, a copy of it stays at the left edge while the steps scroll.
 */
function Rail({ entries, state, steps, hidden, attention, onToggle, onPick, onHighlight, drag }: {
  entries: [string, ResourceDeclaration][];
  state: ResourceState;
  steps: Step[];
  hidden: boolean;
  attention: boolean;
  onToggle: () => void;
  onPick: (name: string) => void;
  onHighlight: (labels: string[] | null) => void;
  drag?: React.HTMLAttributes<HTMLDivElement>;
}) {
  const action = hidden ? 'Show the resources' : 'Hide the resources';
  return (
    <div
      className={`rc-rail${hidden ? ' hidden' : ''}${drag ? ' draggable' : ''}`}
      role="button"
      tabIndex={0}
      aria-expanded={!hidden}
      aria-label={action}
      title={drag ? `${action} · drag to resize` : action}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      {...drag}
    >
      <span className="rc-rail-chevron"><SymbolIcon name={hidden ? 'chevron_right' : 'chevron_left'} size={18} /></span>
      {hidden && entries.map(([name, decl]) => (
        <button
          key={name}
          type="button"
          className="rc-rail-item"
          style={{ '--res-color': metaOf(decl).color ?? DEFAULT_COLOR } as React.CSSProperties}
          title={`${name}: ${STATUS_TEXT[state.statusOf(name).kind]}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onPick(name); }}
          onMouseEnter={() => onHighlight(stepsUsingResource(steps, name))}
          onMouseLeave={() => onHighlight(null)}
        >
          <span className="rc-kind">
            <SymbolIcon name={kindIcon(decl.type, state.types)} size={16} />
            <StatusDot status={state.statusOf(name)} />
          </span>
        </button>
      ))}
      <span className="rc-rail-label">Resources</span>
      {attention && <span className="rc-attention" title="A resource needs attention" />}
      {drag && <span className="rc-grip" aria-hidden />}
    </div>
  );
}

export default function ResourceColumn(props: ResourceColumnProps) {
  const { resources, steps, state, scroller } = props;
  const entries = Object.entries(resources ?? {}) as [string, ResourceDeclaration][];
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [listOpen, setListOpen] = useState(true);
  const [openNames, setOpenNames] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  // Pinning is off unless the viewer turns it on.
  const [pinned, setPinned] = useState(() => readPref(PIN_KEY) === '1');
  const [scrolled, setScrolled] = useState(false);
  // Maximized: one resource as a box the size of the canvas.
  const [maximized, setMaximized] = useState<string | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(900);
  // A width the viewer dragged to; null follows the content (a step's widths).
  const [width, setWidth] = useState<number | null>(() => {
    const w = Number(readPref(WIDTH_KEY));
    return w >= MIN_WIDTH ? w : null;
  });
  const [dragging, setDragging] = useState(false);
  const columnRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragFrom = useRef<{ x: number; width: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCanvasWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [scroller]);

  // Pinned: the thin view shows once the steps scroll off the start.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !pinned) return;   // unpinned, `thin` is off whatever `scrolled` says
    const on = () => setScrolled(el.scrollLeft > 4);
    on();
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, [pinned, scroller]);

  // Hidden, the panel is still there (it slides), but out of reach: no tabbing into it.
  useEffect(() => { if (panelRef.current) panelRef.current.inert = sideCollapsed; }, [sideCollapsed]);

  useEffect(() => {
    if (!dragging) writePref(WIDTH_KEY, width === null ? null : String(width));
  }, [dragging, width]);

  const togglePin = () => { setPinned((p) => { writePref(PIN_KEY, p ? '0' : '1'); return !p; }); };
  const toggleOpen = (name: string) => setOpenNames((s) => {
    const next = new Set(s);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const pick = (name: string) => {
    setSideCollapsed(false); setListOpen(true);
    setOpenNames((s) => new Set(s).add(name));
  };
  const toggleSide = () => {
    if (justDragged.current) { justDragged.current = false; return; }   // the click that ends a drag
    setSideCollapsed((c) => !c);
  };

  // Dragging the bar sets the width, as a step's sides do; dragged far
  // enough left, the column hides, and dragged out again, it shows.
  const drag: React.HTMLAttributes<HTMLDivElement> = {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      const open = sideCollapsed ? 0 : (columnRef.current?.offsetWidth ?? RAIL) - RAIL;
      dragFrom.current = { x: e.clientX, width: open, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e) => {
      const d = dragFrom.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      if (!d.moved && Math.abs(dx) < 4) return;
      if (!d.moved) { d.moved = true; setDragging(true); setMaximized(null); }
      const w = d.width + dx;
      setSideCollapsed(w < HIDE_BELOW);
      if (w >= HIDE_BELOW) {
        setWidth(Math.round(Math.min(Math.max(MIN_WIDTH, w), Math.max(MIN_WIDTH, canvasWidth - 120))));
      }
    },
    onPointerUp: () => {
      if (dragFrom.current?.moved) { justDragged.current = true; setDragging(false); }
      dragFrom.current = null;
    },
    onPointerCancel: () => { dragFrom.current = null; setDragging(false); },
  };

  const attention = entries.some(([n]) => needsAttention(state.statusOf(n)));
  const unused = Object.entries(state.loaded).filter(([n]) => !(resources && n in resources));
  const wide = listOpen && (openNames.size > 0 || adding);
  const railProps = { entries, state, steps, attention, onHighlight: props.onHighlight };

  const toStart = () => scroller.current?.scrollTo({ left: 0, behavior: 'smooth' });
  const thin = pinned && scrolled && (
    <div className="rc-thin" aria-label="Resources (pinned)">
      <Rail {...railProps} hidden
            onToggle={() => { setSideCollapsed(false); toStart(); }}
            onPick={(name) => { pick(name); toStart(); }} />
    </div>
  );

  const maxed = maximized && resources && maximized in resources ? maximized : null;
  const shown = maxed ? entries.filter(([n]) => n === maxed) : entries;
  // The panel keeps its width while the column narrows over it, so hiding
  // and showing slide (0.3s, as a step's do) instead of reflowing.
  const panelWidth = maxed ? Math.max(450, canvasWidth) - RAIL : width ?? (wide ? 450 : MIN_WIDTH);
  const columnWidth = sideCollapsed ? RAIL : panelWidth + RAIL;

  return (
    <>
      {thin}
      <div
        ref={columnRef}
        className={`resource-column${sideCollapsed ? ' rc-collapsed' : ''}${maxed ? ' rc-max' : ''}${dragging ? ' rc-dragging' : ''}`}
        style={{ flexBasis: columnWidth, width: columnWidth }}
        data-testid="resource-column"
      >
        <div className="rc-panel" style={{ width: panelWidth }} ref={panelRef} aria-hidden={sideCollapsed}>
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
          </span>
        </div>

        {listOpen && (
          <div className="rc-list">
            {entries.length === 0 && !adding && (
              <div className="rc-empty">None yet. Steps use a resource with res["name"].</div>
            )}
            {shown.map(([name, decl]) => (
              <ResourceCard
                key={name}
                {...props}
                name={name}
                decl={decl}
                open={openNames.has(name) || maxed === name}
                maximized={maxed === name}
                onMaximize={() => setMaximized(maxed === name ? null : name)}
                onToggle={() => { if (maxed === name) setMaximized(null); toggleOpen(name); }}
                onRenamed={(to) => {
                  setOpenNames((s) => { const n = new Set(s); n.delete(name); n.add(to); return n; });
                  if (maxed === name) setMaximized(to);
                }}
              />
            ))}

            {!maxed && unused.length > 0 && (
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

            {maxed ? null : adding
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
        <Rail {...railProps} hidden={sideCollapsed} onToggle={toggleSide} onPick={pick} drag={drag} />
      </div>
    </>
  );
}

// ── One resource ──────────────────────────────────────────────────────────

function ResourceCard({
  name, decl, open, maximized, onMaximize, onToggle, onRenamed, steps, state, stepColorOf, onDefine, onRemove, onMeta, onHighlight,
}: ResourceColumnProps & {
  name: string;
  decl: ResourceDeclaration;
  open: boolean;
  maximized: boolean;
  onMaximize: () => void;
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
      className={`rc-card${open ? ' open' : ''}${maximized ? ' maximized' : ''}`}
      style={{ '--res-color': color } as React.CSSProperties}
      onMouseEnter={() => onHighlight(users)}
      onMouseLeave={() => onHighlight(null)}
      data-testid={`resource-${name}`}
    >
      <div className="rc-card-head" onClick={onToggle} role="button" aria-expanded={open}>
        <span className="rc-kind" title={decl.type}>
          <SymbolIcon name={kindIcon(decl.type, state.types)} size={16} />
          <StatusDot status={status} />
        </span>
        <span className="rc-card-name">{name}</span>
        {open && <span className="rc-card-type">{decl.type}</span>}
        {open && decl.source === 'loaded' && <span className="rc-tag" title="Provided by the deployment">ready-made</span>}
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
            <button type="button" className="rc-btn-icon" title={maximized ? 'Restore size' : 'Maximize'} onClick={onMaximize}>
              <SymbolIcon name={maximized ? 'close_fullscreen' : 'open_in_full'} size={12} />
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

          {(status.kind === 'loaded' || maximized) && (
            <div className="rc-browse">
              <SymbolIcon name={kindIcon(decl.type, state.types)} size={maximized ? 40 : 22} />
              <span>
                {status.kind === 'loaded'
                  ? `Browse ${name}: a file system's tree or a database's tables will show here.`
                  : `Load ${name} to browse it.`}
              </span>
            </div>
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

import React, { useEffect, useState } from 'react';
import type {
  CopilotSession, SessionSummary, TemplateRef, TraceRecord,
} from '../services/agentApi';
import SymbolIcon from './SymbolIcon';
import './CopilotViews.css';

/**
 * The copilot session's views inside the chat pane (spec 018): the sessions
 * list, the plan with its milestones, the trace, and the context the copilot
 * reads. Plain on purpose: the look comes later.
 */

const PHASE_TEXT = { plan: 'planning', build: 'building', done: 'done' } as const;

export function progressOf(session: CopilotSession | null): { done: number; total: number } {
  const ms = session?.plan?.milestones ?? [];
  return { done: ms.filter((m) => m.status === 'done').length, total: ms.length };
}

/** One line under the header: this workflow's session, its phase and progress. */
export function SessionBar({ session, open, onToggle }: {
  session: CopilotSession | null; open: boolean; onToggle: () => void;
}) {
  if (!session) return null;
  const { done, total } = progressOf(session);
  return (
    <button className="copilot-session-bar" onClick={onToggle} title="Sessions: one per workflow" aria-expanded={open}>
      <span className="copilot-session-title">{session.title}</span>
      <span className={`copilot-phase copilot-phase-${session.phase}`}>{PHASE_TEXT[session.phase]}</span>
      {total > 0 && <span className="copilot-progress">{done}/{total} milestones</span>}
      <SymbolIcon name="arrow_drop_down" size={16} />
    </button>
  );
}

/** Every saved session; the current workflow's is marked. */
export function SessionList({ sessions, currentId, onReset }: {
  sessions: SessionSummary[]; currentId?: string; onReset: (id: string) => void;
}) {
  return (
    <div className="copilot-session-list">
      {sessions.length === 0 && <div className="copilot-muted">No saved sessions yet.</div>}
      {sessions.map((s) => (
        <div key={s.id} className={`copilot-session-item${s.id === currentId ? ' current' : ''}`}
             title={s.id === currentId ? 'This workflow' : 'Open this workflow to continue its session'}>
          <div className="copilot-session-item-main">
            <b>{s.title}</b>
            <span className={`copilot-phase copilot-phase-${s.phase}`}>{PHASE_TEXT[s.phase]}</span>
            {s.total > 0 && <span className="copilot-progress">{s.done}/{s.total}</span>}
          </div>
          {s.goal && <div className="copilot-muted">{s.goal}</div>}
          <div className="copilot-muted">{s.turns} turns · {s.updated.replace('T', ' ')}</div>
          {s.id === currentId && (
            <button className="copilot-link" onClick={() => onReset(s.id)}>
              <SymbolIcon name="delete" size={13} /> Start over
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

const MILESTONE_ICON = { done: 'check_circle', active: 'play_circle', todo: 'hourglass_empty' } as const;

/** The goal, the proposed resources and steps, and the dev plan's milestones. */
export function PlanView({ session, busy, onGoal, onAccept, onReplan }: {
  session: CopilotSession; busy: boolean;
  onGoal: (goal: string) => void; onAccept: () => void; onReplan: () => void;
}) {
  const [goal, setGoal] = useState(session.goal);
  useEffect(() => setGoal(session.goal), [session.goal]);
  const plan = session.plan;
  return (
    <div className="copilot-view">
      <label className="copilot-label">Goal</label>
      <textarea className="copilot-textarea" rows={2} value={goal} placeholder="What the workflow is for"
                onChange={(e) => setGoal(e.target.value)}
                onBlur={() => goal !== session.goal && onGoal(goal)} />
      {session.questions.length > 0 && (
        <>
          <label className="copilot-label">Open questions</label>
          <ul className="copilot-list">{session.questions.map((q) => <li key={q}>{q}</li>)}</ul>
          <div className="copilot-muted">Answer them in the chat.</div>
        </>
      )}
      {!plan && session.questions.length === 0 && (
        <div className="copilot-muted">No plan yet: describe the goal in the chat.</div>
      )}
      {plan && (
        <>
          <label className="copilot-label">Resources</label>
          {plan.resources.length === 0
            ? <div className="copilot-muted">none</div>
            : <ul className="copilot-list">{plan.resources.map((r) => <li key={r.name}><code>res["{r.name}"]</code> {r.why}</li>)}</ul>}
          <label className="copilot-label">Steps</label>
          <ol className="copilot-list">
            {plan.steps.map((s) => (
              <li key={s.name}><b>{s.name}</b> <code>{s.tool}</code> {s.purpose}</li>
            ))}
          </ol>
          <label className="copilot-label">Dev plan</label>
          <ol className="copilot-milestones">
            {plan.milestones.map((m, i) => (
              <li key={i} className={`copilot-milestone ${m.status}`}>
                <SymbolIcon name={MILESTONE_ICON[m.status]} size={14} />
                <div>
                  <div><b>{m.title}</b> <span className="copilot-muted">({m.steps.join(', ')})</span></div>
                  <div className="copilot-muted">done when: {m.check}</div>
                  {m.last_check && <div className="copilot-muted">last check: {m.last_check}</div>}
                </div>
              </li>
            ))}
          </ol>
          {plan.problems && plan.problems.length > 0 && (
            <ul className="copilot-list copilot-problems">{plan.problems.map((p) => <li key={p}>{p}</li>)}</ul>
          )}
        </>
      )}
      <div className="copilot-actions">
        {plan && session.phase === 'plan' && (
          <button className="copilot-btn primary" disabled={busy || !!plan.problems?.length} onClick={onAccept}>
            <SymbolIcon name="check" size={14} /> Accept plan
          </button>
        )}
        {(plan || session.goal) && (
          <button className="copilot-btn" disabled={busy} onClick={onReplan} title="Plan again from the goal and the chat">
            <SymbolIcon name="refresh" size={14} /> Replan
          </button>
        )}
      </div>
    </div>
  );
}

/** One row per turn: where the session is, and what each turn cost. */
export function TraceView({ trace }: { trace: TraceRecord[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (trace.length === 0) return <div className="copilot-view copilot-muted">No turns yet.</div>;
  const calls = trace.reduce((n, r) => n + r.model_calls, 0);
  const seconds = trace.reduce((n, r) => n + (r.seconds ?? 0), 0);
  return (
    <div className="copilot-view">
      <div className="copilot-muted">{trace.length} turns · {calls} model calls · {seconds.toFixed(1)}s</div>
      <table className="copilot-trace">
        <thead><tr><th>#</th><th>phase</th><th>action</th><th>M</th><th>calls</th><th>outcome</th></tr></thead>
        <tbody>
          {trace.map((r) => (
            <React.Fragment key={r.turn}>
              <tr className={r.problems.length ? 'has-problems' : ''} onClick={() => setOpen(open === r.turn ? null : r.turn)}>
                <td>{r.turn}</td><td>{r.phase}</td><td>{r.action}</td><td>{r.milestone ?? ''}</td>
                <td>{r.model_calls}</td><td>{r.outcome}</td>
              </tr>
              {open === r.turn && (
                <tr className="copilot-trace-detail"><td colSpan={6}>
                  <div>{r.at.replace('T', ' ')} · {r.model || 'no model'} · {(r.seconds ?? 0).toFixed(2)}s</div>
                  <div>read: {Object.entries(r.context).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(' · ')} chars</div>
                  {r.problems.map((p) => <div key={p} className="copilot-problems">{p}</div>)}
                </td></tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What the copilot reads besides the workflow: notes, and earlier workflows as templates. */
export function ContextView({ session, templates, onNotes, onTemplates }: {
  session: CopilotSession; templates: TemplateRef[];
  onNotes: (notes: string) => void; onTemplates: (refs: TemplateRef[]) => void;
}) {
  const [notes, setNotes] = useState(session.context.notes);
  useEffect(() => setNotes(session.context.notes), [session.context.notes]);
  const chosen = new Set(session.context.templates.map((t) => `${t.project}/${t.workflow}`));
  const toggle = (t: TemplateRef) => {
    const key = `${t.project}/${t.workflow}`;
    const next = templates.filter((x) => {
      const k = `${x.project}/${x.workflow}`;
      return k === key ? !chosen.has(key) : chosen.has(k);
    });
    onTemplates(next.map(({ project, workflow }) => ({ project, workflow })));
  };
  const last = session.trace[session.trace.length - 1];
  return (
    <div className="copilot-view">
      <label className="copilot-label"><SymbolIcon name="edit_note" size={14} /> Notes</label>
      <textarea className="copilot-textarea" rows={5} value={notes}
                placeholder="Domain knowledge, conventions, column meanings… the copilot reads these every turn"
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => notes !== session.context.notes && onNotes(notes)} />
      <label className="copilot-label"><SymbolIcon name="folder" size={14} /> Templates</label>
      {templates.filter((t) => t.workflow !== session.id).map((t) => (
        <label key={`${t.project}/${t.workflow}`} className="copilot-check">
          <input type="checkbox" checked={chosen.has(`${t.project}/${t.workflow}`)} onChange={() => toggle(t)} />
          {t.label ?? `${t.project} / ${t.workflow}`}
        </label>
      ))}
      {templates.length === 0 && <div className="copilot-muted">No other workflows in this workspace.</div>}
      <label className="copilot-label"><SymbolIcon name="analytics" size={14} /> What the last turn read</label>
      {last
        ? <ul className="copilot-list">{Object.entries(last.context).map(([k, n]) => <li key={k}>{k}: {n} chars</li>)}</ul>
        : <div className="copilot-muted">Nothing yet.</div>}
    </div>
  );
}

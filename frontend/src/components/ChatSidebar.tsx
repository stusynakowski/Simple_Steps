import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Workflow } from '../types/models';
import type { WorkflowCommand } from '../types/commands';
import {
  getAgentStatus, getSession, listSessions, listTemplates, resetSession, sessionTurn, updateSession,
  type AgentStatus, type CopilotSession, type SessionMessage, type SessionSummary, type TemplateRef,
} from '../services/agentApi';
import {
  changeKey,
  changesToCommands,
  type AgentChange,
  type AgentProposal,
} from '../utils/proposal';
import {
  mdiArrowUp, mdiClose, mdiCogOutline, mdiCreationOutline, mdiCubeOutline,
  mdiFormatListNumbered, mdiLoading, mdiMinus, mdiPencilOutline, mdiPlus, mdiPowerPlugOutline,
  mdiRobotOutline,
} from '@mdi/js';
import AgentConfigPanel from './AgentConfigPanel';
import MaterialIcon from './MaterialIcon';
import SymbolIcon from './SymbolIcon';
import { ContextView, PlanView, SessionBar, SessionList, TraceView } from './CopilotViews';
import './ChatSidebar.css';
import './AgentProposal.css';

/**
 * The copilot pane (spec 018; plan 128). One **session per workflow**, saved
 * on the server: the copilot plans with the user (asking questions first if
 * it must), proposes the resources, steps and a dev plan of milestones, then
 * builds the plan **one turn at a time**: it proposes a milestone's steps,
 * the user applies and runs them, and Continue validates the output before
 * the next milestone. Tabs show the chat, the plan, the trace and the context.
 *
 * The copilot **proposes**; the user picks which changes to keep, applies
 * them, and runs the steps. Every proposed formula has been checked by the
 * backend; a change that failed its checks shows the reason and can't be
 * applied. Applying sends the same commands the console does.
 */

interface ChatSidebarProps {
  isVisible: boolean;
  onClose?: () => void;
  /** The workflow the copilot reads (steps, outputs, resources); its id names the session. */
  workflow?: Workflow;
  /** Apply commands in order — MainLayout routes them through dispatchCommand. */
  onApplyCommands?: (commands: WorkflowCommand[]) => Promise<void>;
}

type Tab = 'chat' | 'plan' | 'trace' | 'context';

const WELCOME =
  'Tell me what this workflow should do. I\'ll ask what I need to, propose a plan ' +
  '(resources, steps and milestones), then build it with you one milestone at a time.';

const PLACEHOLDER: Record<CopilotSession['phase'], string> = {
  plan: 'Describe what you want the workflow to do…',
  build: 'Feedback on this milestone, or press Continue…',
  done: 'Ask for a change…',
};

const ChatSidebar: React.FC<ChatSidebarProps> = ({ isVisible, onClose, workflow, onApplyCommands }) => {
  const [session, setSession] = useState<CopilotSession | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('chat');
  const [listOpen, setListOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [templates, setTemplates] = useState<TemplateRef[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const workflowId = workflow?.id;

  useEffect(() => { endRef.current?.scrollIntoView?.({ behavior: 'smooth' }); }, [session?.messages.length, tab]);

  useEffect(() => {
    if (isVisible && !configOpen) {
      getAgentStatus().then(setStatus).catch(() => setStatus({ available: false, reason: 'unreachable' }));
    }
  }, [isVisible, configOpen]);

  // The workflow's session: one per workflow, loaded when the workflow changes.
  useEffect(() => {
    if (!isVisible || !workflowId) { setSession(null); return; }
    let live = true;
    getSession(workflowId, workflow?.name ?? '')
      .then((s) => { if (live) { setSession(s); setProblem(null); } })
      .catch((e) => live && setProblem(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, workflowId]);

  useEffect(() => {
    if (listOpen) listSessions().then(setSessions).catch(() => setSessions([]));
  }, [listOpen, session?.updated]);

  useEffect(() => {
    if (tab === 'context') listTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, [tab]);

  const stepsContext = useCallback(() => (workflow?.steps ?? []).map((s) => ({
    name: s.label,
    formula: s.formula ?? '',
    status: s.status,
    error: s.status === 'error' ? s.output_preview?.[0]?.display_value : undefined,
    output_ref: s.outputRefId,
  })), [workflow]);

  const turn = useCallback(async (action: 'continue' | 'accept' | 'replan', message = '') => {
    if (!workflowId || busy) return;
    setBusy(true);
    setProblem(null);
    if (message) {
      // Shown at once; the saved session replaces it when the turn returns.
      setSession((s) => s && { ...s, messages: [...s.messages, { id: 'pending', role: 'user', content: message }] });
    }
    try {
      const next = await sessionTurn(workflowId, {
        action, message, title: workflow?.name ?? '', steps: stepsContext(), resources: workflow?.resources ?? {},
      });
      setSession(next);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      setSession((s) => s && { ...s, messages: s.messages.filter((m) => m.id !== 'pending') });
    } finally {
      setBusy(false);
    }
  }, [workflowId, busy, workflow, stepsContext]);

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    void turn('continue', text);
  };

  const edit = async (patch: Parameters<typeof updateSession>[1]) => {
    if (!workflowId) return;
    try { setSession(await updateSession(workflowId, patch)); }
    catch (e) { setProblem(e instanceof Error ? e.message : String(e)); }
  };

  const markApplied = (id: string, count: number) => {
    setSession((s) => s && { ...s, messages: s.messages.map((m) => (m.id === id ? { ...m, applied: count } : m)) });
    if (workflowId) updateSession(workflowId, { applied: { [id]: count } }).catch(() => {});
  };

  const startOver = async (id: string) => {
    await resetSession(id);
    setListOpen(false);
    setTab('chat');
    if (workflowId) setSession(await getSession(workflowId, workflow?.name ?? ''));
  };

  if (!isVisible) return null;
  const ready = !!status?.available;
  const phase = session?.phase ?? 'plan';
  const canAccept = phase === 'plan' && !!session?.plan && !session.plan.problems?.length;

  return (
    <div className="chat-sidebar">
      <div className="chat-sidebar-header">
        <div className="chat-header-left">
          <span className="chat-header-icon"><MaterialIcon path={mdiCreationOutline} size={16} /></span>
          <span className="chat-header-title">Simple Steps Copilot</span>
          <span
            className={`connection-dot ${ready ? 'connected' : 'disconnected'}`}
            title={ready ? `Using ${status?.model}` : status?.reason ?? 'Checking…'}
          />
        </div>
        <div className="chat-header-actions">
          <button className="chat-header-btn" onClick={() => setConfigOpen(true)} title="Copilot settings" aria-label="Copilot settings">
            <MaterialIcon path={mdiCogOutline} />
          </button>
          {onClose && (
            <button className="chat-header-btn" onClick={onClose} title="Close" aria-label="Close">
              <MaterialIcon path={mdiClose} />
            </button>
          )}
        </div>
      </div>

      <SessionBar session={session} open={listOpen} onToggle={() => setListOpen((o) => !o)} />
      {listOpen && <SessionList sessions={sessions} currentId={workflowId} onReset={(id) => void startOver(id)} />}

      <div className="chat-context-bar">
        <span className="context-item" title="What the copilot reads">
          <MaterialIcon path={mdiFormatListNumbered} size={13} /> {workflow?.steps.length ?? 0} steps
        </span>
        <span className="context-item" title="Resources this workflow names">
          <MaterialIcon path={mdiPowerPlugOutline} size={13} /> {Object.keys(workflow?.resources ?? {}).length} resources
        </span>
        {ready && (
          <span className="context-item" title="The model">
            <MaterialIcon path={mdiRobotOutline} size={13} /> {status?.model}
          </span>
        )}
      </div>

      <div className="copilot-tabs" role="tablist">
        {(['chat', 'plan', 'trace', 'context'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`copilot-tab${tab === t ? ' active' : ''}`}
                  onClick={() => setTab(t)}>
            {t === 'trace' && session ? `trace (${session.trace.length})` : t}
          </button>
        ))}
      </div>

      {!workflowId && <div className="copilot-view copilot-muted">Open a workflow: each workflow has its own copilot session.</div>}

      {session && tab === 'chat' && (
        <div className="chat-messages">
          <div className="chat-message assistant"><div className="message-content">{WELCOME}</div></div>
          {session.messages.map((m) => (
            <ChatMessage key={m.id} m={m} workflow={workflow} onShowPlan={() => setTab('plan')}
                         onApply={async (commands) => {
                           if (!onApplyCommands) return;
                           await onApplyCommands(commands);
                           markApplied(m.id, commands.length);
                         }} />
          ))}
          {busy && (
            <div className="chat-message assistant">
              <div className="message-content"><span className="streaming-indicator">●</span> Thinking…</div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}
      {session && tab === 'plan' && (
        <PlanView session={session} busy={busy || !ready}
                  onGoal={(goal) => void edit({ goal })}
                  onAccept={() => { setTab('chat'); void turn('accept'); }}
                  onReplan={() => { setTab('chat'); void turn('replan'); }} />
      )}
      {session && tab === 'trace' && <TraceView trace={session.trace} />}
      {session && tab === 'context' && (
        <ContextView session={session} templates={templates}
                     onNotes={(notes) => void edit({ notes })}
                     onTemplates={(refs) => void edit({ templates: refs })} />
      )}

      <div className="chat-input-area">
        {status && !ready && (
          <div className="agent-setup-hint">
            <span>The copilot is off: {status.reason}</span>
            <button onClick={() => setConfigOpen(true)}>Settings →</button>
          </div>
        )}
        {problem && <div className="agent-change-problem">{problem}</div>}
        {session && (canAccept || phase === 'build') && (
          <div className="copilot-actions">
            {canAccept && (
              <button className="copilot-btn primary" disabled={busy || !ready} onClick={() => void turn('accept')}>
                <SymbolIcon name="check" size={14} /> Accept plan
              </button>
            )}
            {phase === 'build' && (
              <button className="copilot-btn primary" disabled={busy || !ready} onClick={() => void turn('continue')}
                      title="The next turn: propose this milestone's steps, or check what they produced">
                <SymbolIcon name="play_arrow" size={14} /> Continue
              </button>
            )}
          </div>
        )}
        <div className="chat-input-row">
          <textarea
            className="chat-input"
            placeholder={ready ? PLACEHOLDER[phase] : 'The copilot is off'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            rows={2}
            disabled={busy || !ready || !session}
          />
          <button
            className="chat-send-btn"
            onClick={send}
            disabled={busy || !ready || !input.trim() || !session}
            title="Send"
          >
            {busy ? <MaterialIcon path={mdiLoading} spin /> : <MaterialIcon path={mdiArrowUp} />}
          </button>
        </div>
      </div>

      <AgentConfigPanel isOpen={configOpen} onClose={() => setConfigOpen(false)} />
    </div>
  );
};

/** One message: its text, and what it carries (questions, a plan, a proposal, a check). */
function ChatMessage({ m, workflow, onApply, onShowPlan }: {
  m: SessionMessage; workflow?: Workflow;
  onApply: (commands: WorkflowCommand[]) => Promise<void>; onShowPlan: () => void;
}) {
  const who = m.role === 'user' ? 'You' : m.kind === 'error' ? 'Problem' : 'Copilot';
  return (
    <div className={`chat-message ${m.role}${m.kind === 'error' ? ' agent-error' : ''}`}>
      <div className="message-header">
        <strong>{who}</strong>
        {m.kind === 'validation' && (
          <span className={`copilot-check-mark ${m.passed ? 'passed' : 'failed'}`}>
            <SymbolIcon name={m.passed ? 'check_circle' : 'error'} size={13} /> {m.passed ? 'check passed' : 'check failed'}
          </span>
        )}
      </div>
      <div className="message-content">{m.content}</div>
      {m.questions && m.questions.length > 0 && (
        <ul className="copilot-list">{m.questions.map((q) => <li key={q}>{q}</li>)}</ul>
      )}
      {m.plan && (
        <button className="copilot-link" onClick={onShowPlan}>
          {m.plan.steps.length} steps, {m.plan.milestones.length} milestones
          {m.plan.problems?.length ? `, ${m.plan.problems.length} problems` : ''}: see the plan
        </button>
      )}
      {m.proposal && m.proposal.changes.length > 0 && (
        <ProposalCard
          proposal={m.proposal}
          applied={m.applied}
          existingSteps={(workflow?.steps ?? []).map((s) => s.label)}
          onApply={onApply}
        />
      )}
    </div>
  );
}

const KIND_MARK: Record<AgentChange['kind'], string> = {
  resource: mdiCubeOutline, add: mdiPlus, change: mdiPencilOutline, remove: mdiMinus,
};
const KIND_TEXT: Record<AgentChange['kind'], string> = {
  resource: 'use resource', add: 'add step', change: 'change step', remove: 'remove step',
};

/** One proposal: its changes, each selectable unless it failed its checks. */
export function ProposalCard({
  proposal,
  applied,
  existingSteps,
  onApply,
}: {
  proposal: AgentProposal;
  applied?: number;
  existingSteps: string[];
  onApply: (commands: WorkflowCommand[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(proposal.changes.filter((c) => !c.problem).map(changeKey)),
  );
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const done = applied !== undefined;

  const toggle = (key: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const apply = async () => {
    setApplying(true);
    setError(null);
    try {
      await onApply(changesToCommands(proposal.changes, selected, existingSteps));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  const count = proposal.changes.filter((c) => !c.problem && selected.has(changeKey(c))).length;

  return (
    <div className="agent-proposal">
      {proposal.changes.map((change) => {
        const key = changeKey(change);
        return (
          <label key={key} className={`agent-change agent-change-${change.kind}${change.problem ? ' invalid' : ''}`}>
            <input
              type="checkbox"
              checked={!change.problem && selected.has(key)}
              disabled={!!change.problem || done}
              onChange={() => toggle(key)}
            />
            <span className="agent-change-mark"><MaterialIcon path={KIND_MARK[change.kind]} size={13} /></span>
            <span className="agent-change-body">
              <span className="agent-change-title">{KIND_TEXT[change.kind]} <b>{change.name}</b></span>
              {'formula' in change && <code className="agent-change-formula">{change.formula}</code>}
              {change.kind === 'resource' && <code className="agent-change-formula">{change.definition}</code>}
              {change.kind === 'change' && (
                <code className="agent-change-formula agent-change-before">{change.before}</code>
              )}
              {change.problem && <span className="agent-change-problem">{change.problem}</span>}
            </span>
          </label>
        );
      })}
      <div className="agent-proposal-actions">
        {done ? (
          <span className="agent-proposal-done">Applied {applied} command{applied === 1 ? '' : 's'}. Run the steps to see the results.</span>
        ) : (
          <button className="apply-formula-btn" onClick={() => void apply()} disabled={applying || count === 0}>
            {applying ? 'Applying…' : `Apply ${count} change${count === 1 ? '' : 's'}`}
          </button>
        )}
        {proposal.attempts > 1 && (
          <span className="agent-proposal-note" title="The checks sent problems back to the model">
            corrected {proposal.attempts - 1}×
          </span>
        )}
      </div>
      {error && <div className="agent-change-problem">{error}</div>}
    </div>
  );
}

export default ChatSidebar;

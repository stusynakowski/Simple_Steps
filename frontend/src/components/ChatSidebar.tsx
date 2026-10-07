import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Workflow } from '../types/models';
import type { WorkflowCommand } from '../types/commands';
import { getAgentStatus, proposeChanges, type AgentStatus } from '../services/agentApi';
import {
  changeKey,
  changesToCommands,
  type AgentChange,
  type AgentProposal,
} from '../utils/proposal';
import AgentConfigPanel from './AgentConfigPanel';
import './ChatSidebar.css';
import './AgentProposal.css';

/**
 * The agent panel (docs/dev_plan/122 §3). The agent **proposes**; the user
 * picks which changes to keep and applies them, and runs the steps. Every
 * proposed formula has been checked by the backend before it appears here; a
 * change that failed its checks is shown with the reason and can't be applied.
 * Applying sends the same commands the console does, so it's in the transcript.
 */

interface ChatSidebarProps {
  isVisible: boolean;
  onClose?: () => void;
  /** The workflow the agent reads (steps, outputs, resources). */
  workflow?: Workflow;
  /** Apply commands in order — MainLayout routes them through dispatchCommand. */
  onApplyCommands?: (commands: WorkflowCommand[]) => Promise<void>;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  proposal?: AgentProposal;
  applied?: number;
  error?: boolean;
}

const WELCOME: Message = {
  id: 'welcome',
  role: 'assistant',
  content:
    'I suggest steps for your workflow; you choose what to keep and run it. ' +
    'Try: "load these cities and count readings per city", or ask what a tool does.',
};

let nextId = 0;
const newId = () => `m${++nextId}`;

const ChatSidebar: React.FC<ChatSidebarProps> = ({ isVisible, onClose, workflow, onApplyCommands }) => {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (isVisible && !configOpen) {
      getAgentStatus().then(setStatus).catch(() => setStatus({ available: false, reason: 'unreachable' }));
    }
  }, [isVisible, configOpen]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    const history = messages
      .filter((m) => m.id !== 'welcome' && (m.role === 'user' || m.role === 'assistant') && !m.error)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    setMessages((prev) => [...prev, { id: newId(), role: 'user', content: text }]);
    setBusy(true);
    try {
      const steps = (workflow?.steps ?? []).map((s) => ({
        name: s.label,
        formula: s.formula ?? '',
        status: s.status,
        error: s.status === 'error' ? s.output_preview?.[0]?.display_value : undefined,
        output_ref: s.outputRefId,
      }));
      const proposal = await proposeChanges({
        message: text,
        steps,
        resources: workflow?.resources ?? {},
        history,
      });
      setMessages((prev) => [...prev, {
        id: newId(), role: 'assistant', content: proposal.summary || '(no summary)', proposal,
      }]);
    } catch (e) {
      setMessages((prev) => [...prev, {
        id: newId(), role: 'system', error: true,
        content: e instanceof Error ? e.message : String(e),
      }]);
    } finally {
      setBusy(false);
    }
  }, [input, busy, messages, workflow]);

  const markApplied = (id: string, count: number) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, applied: count } : m)));

  if (!isVisible) return null;
  const ready = !!status?.available;

  return (
    <div className="chat-sidebar">
      <div className="chat-sidebar-header">
        <div className="chat-header-left">
          <span className="chat-header-icon">✨</span>
          <span className="chat-header-title">Simple Steps Agent</span>
          <span
            className={`connection-dot ${ready ? 'connected' : 'disconnected'}`}
            title={ready ? `Using ${status?.model}` : status?.reason ?? 'Checking…'}
          />
        </div>
        <div className="chat-header-actions">
          <button className="chat-header-btn" onClick={() => setConfigOpen(true)} title="Agent settings">⚙️</button>
          <button className="chat-header-btn" onClick={() => setMessages([WELCOME])} title="Clear chat">🗑️</button>
          {onClose && <button className="chat-header-btn" onClick={onClose} title="Close">✕</button>}
        </div>
      </div>

      <div className="chat-context-bar">
        <span className="context-item" title="What the agent reads">📋 {workflow?.steps.length ?? 0} steps</span>
        <span className="context-item" title="Resources this workflow names">
          🔌 {Object.keys(workflow?.resources ?? {}).length} resources
        </span>
        {ready && <span className="context-item" title="The model">🤖 {status?.model}</span>}
      </div>

      <div className="chat-messages">
        {messages.map((m) => (
          <div key={m.id} className={`chat-message ${m.role}${m.error ? ' agent-error' : ''}`}>
            <div className="message-header">
              <strong>{m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Agent' : 'Problem'}</strong>
            </div>
            <div className="message-content">{m.content}</div>
            {m.proposal && m.proposal.changes.length > 0 && (
              <ProposalCard
                proposal={m.proposal}
                applied={m.applied}
                existingSteps={(workflow?.steps ?? []).map((s) => s.label)}
                onApply={async (commands) => {
                  if (!onApplyCommands) return;
                  await onApplyCommands(commands);
                  markApplied(m.id, commands.length);
                }}
              />
            )}
          </div>
        ))}
        {busy && (
          <div className="chat-message assistant">
            <div className="message-content"><span className="streaming-indicator">●</span> Thinking…</div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="chat-input-area">
        {status && !ready && (
          <div className="agent-setup-hint">
            <span>The agent is off: {status.reason}</span>
            <button onClick={() => setConfigOpen(true)}>Settings →</button>
          </div>
        )}
        <div className="chat-input-row">
          <textarea
            className="chat-input"
            placeholder={ready ? 'Describe what you want the workflow to do…' : 'The agent is off'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
            }}
            rows={2}
            disabled={busy || !ready}
          />
          <button
            className="chat-send-btn"
            onClick={() => void send()}
            disabled={busy || !ready || !input.trim()}
            title="Send"
          >
            {busy ? '⏳' : '↑'}
          </button>
        </div>
      </div>

      <AgentConfigPanel isOpen={configOpen} onClose={() => setConfigOpen(false)} />
    </div>
  );
};

const KIND_MARK: Record<AgentChange['kind'], string> = {
  resource: '◆', add: '+', change: '~', remove: '−',
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
            <span className="agent-change-mark">{KIND_MARK[change.kind]}</span>
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

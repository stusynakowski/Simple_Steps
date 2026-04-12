import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { Step, Workflow } from '../types/models';
import type { OperationDefinition } from '../services/api';
import type { ChatMessage } from '../services/agentApi';
import {
  sendAgentMessage,
  createAgentWebSocket,
  getAgentHealth,
} from '../services/agentApi';
import AgentConfigPanel from './AgentConfigPanel';
import './ChatSidebar.css';

interface ChatSidebarProps {
  isVisible: boolean;
  onClose?: () => void;
  /** Current workflow state — passed down from MainLayout */
  workflow?: Workflow;
  /** Currently focused step (if any) */
  currentStep?: Step | null;
  /** All available operations from the backend */
  availableOperations?: OperationDefinition[];
  /** Callback when the agent suggests a formula to apply */
  onApplyFormula?: (stepId: string, formula: string) => void;
}

const ChatSidebar: React.FC<ChatSidebarProps> = ({
  isVisible,
  onClose,
  workflow,
  currentStep,
  availableOperations,
  onApplyFormula,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Hi! I\'m the **Simple Steps Agent**. I can help you choose the right function for each step and refine its arguments.\n\nTry asking:\n- "What operations are available for filtering?"\n- "Help me configure this step"\n- "Suggest a function for cleaning my data"',
      timestamp: new Date().toISOString(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [useStreaming, setUseStreaming] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [agentReady, setAgentReady] = useState<boolean | null>(null);

  // Connection status derived from WS state
  const connectionReady = agentReady && (!useStreaming || isConnected);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<ReturnType<typeof createAgentWebSocket> | null>(null);
  const streamingMessageRef = useRef<string>('');

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Check agent health on mount
  useEffect(() => {
    if (isVisible) {
      getAgentHealth()
        .then(h => setAgentReady(h.ready))
        .catch(() => setAgentReady(false));
    }
  }, [isVisible, configOpen]);

  // Clean up WebSocket on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages(prev => [...prev, msg]);
  }, []);

  const updateLastAssistantMessage = useCallback((content: string) => {
    setMessages(prev => {
      const copy = [...prev];
      const lastIdx = copy.length - 1;
      if (lastIdx >= 0 && copy[lastIdx].role === 'assistant') {
        copy[lastIdx] = { ...copy[lastIdx], content };
      }
      return copy;
    });
  }, []);

  const handleSendMessage = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || isStreaming) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    addMessage(userMsg);
    setInputValue('');
    setIsStreaming(true);

    const steps = workflow?.steps ?? [];
    const ops = availableOperations ?? [];
    const history = messages.filter(m => m.role === 'user' || m.role === 'assistant');

    if (useStreaming) {
      // Streaming via WebSocket
      streamingMessageRef.current = '';

      // Add placeholder assistant message
      const placeholderId = `stream-${Date.now()}`;
      addMessage({
        id: placeholderId,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        isStreaming: true,
      });

      if (!wsRef.current || !wsRef.current.isConnected()) {
        wsRef.current = createAgentWebSocket(
          // onToken
          (token) => {
            streamingMessageRef.current += token;
            updateLastAssistantMessage(streamingMessageRef.current);
          },
          // onDone
          (fullMessage, suggestedFormula) => {
            setMessages(prev => {
              const copy = [...prev];
              const lastIdx = copy.length - 1;
              if (lastIdx >= 0 && copy[lastIdx].role === 'assistant') {
                copy[lastIdx] = {
                  ...copy[lastIdx],
                  content: fullMessage,
                  suggested_formula: suggestedFormula,
                  isStreaming: false,
                };
              }
              return copy;
            });
            setIsStreaming(false);
          },
          // onError
          (error) => {
            updateLastAssistantMessage(`⚠️ ${error}`);
            setIsStreaming(false);
          },
          // onOpen
          () => setIsConnected(true),
          // onClose
          () => setIsConnected(false),
        );
      }

      // Small delay to ensure WS is connected
      setTimeout(() => {
        wsRef.current?.send(text, steps, ops, currentStep, history);
      }, 100);
    } else {
      // Non-streaming REST call
      addMessage({
        id: `thinking-${Date.now()}`,
        role: 'assistant',
        content: '🤔 Thinking…',
        timestamp: new Date().toISOString(),
        isStreaming: true,
      });

      try {
        const response = await sendAgentMessage(
          text,
          steps,
          ops,
          currentStep,
          history,
        );

        setMessages(prev => {
          const copy = [...prev];
          const lastIdx = copy.length - 1;
          if (lastIdx >= 0 && copy[lastIdx].isStreaming) {
            copy[lastIdx] = {
              ...copy[lastIdx],
              content: response.message,
              suggested_formula: response.suggested_formula,
              isStreaming: false,
            };
          }
          return copy;
        });
      } catch (e) {
        updateLastAssistantMessage(`⚠️ ${e instanceof Error ? e.message : 'Request failed'}`);
      } finally {
        setIsStreaming(false);
      }
    }
  }, [
    inputValue,
    isStreaming,
    messages,
    workflow,
    currentStep,
    availableOperations,
    useStreaming,
    addMessage,
    updateLastAssistantMessage,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleApplyFormula = (formula: string) => {
    if (currentStep && onApplyFormula) {
      onApplyFormula(currentStep.id, formula);
      addMessage({
        id: `system-${Date.now()}`,
        role: 'system',
        content: `✅ Applied formula \`${formula}\` to step "${currentStep.label}"`,
        timestamp: new Date().toISOString(),
      });
    }
  };

  const handleClearChat = () => {
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: 'Chat cleared. How can I help you with your workflow?',
        timestamp: new Date().toISOString(),
      },
    ]);
  };

  if (!isVisible) return null;

  return (
    <div className="chat-sidebar">
      {/* Header */}
      <div className="chat-sidebar-header">
        <div className="chat-header-left">
          <span className="chat-header-icon">✨</span>
          <span className="chat-header-title">Simple Steps Agent</span>
          <span className={`connection-dot ${connectionReady ? 'connected' : 'disconnected'}`} 
                title={connectionReady ? 'Agent ready' : 'Agent not configured'} />
        </div>
        <div className="chat-header-actions">
          <button
            className="chat-header-btn"
            onClick={() => setUseStreaming(s => !s)}
            title={useStreaming ? 'Streaming mode (click for batch)' : 'Batch mode (click for streaming)'}
          >
            {useStreaming ? '⚡' : '📦'}
          </button>
          <button className="chat-header-btn" onClick={() => setConfigOpen(true)} title="Agent Settings">
            ⚙️
          </button>
          <button className="chat-header-btn" onClick={handleClearChat} title="Clear Chat">
            🗑️
          </button>
          {onClose && (
            <button className="chat-header-btn" onClick={onClose} title="Close">
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Context bar — shows what the agent can see */}
      <div className="chat-context-bar">
        <span className="context-item" title="Workflow steps">
          📋 {workflow?.steps.length ?? 0} steps
        </span>
        <span className="context-item" title="Available operations">
          🔧 {availableOperations?.length ?? 0} ops
        </span>
        {currentStep && (
          <span className="context-item context-step" title={`Focused: ${currentStep.label}`}>
            🎯 {currentStep.label}
          </span>
        )}
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.map(msg => (
          <div key={msg.id} className={`chat-message ${msg.role}`}>
            <div className="message-header">
              <strong>
                {msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'Agent' : 'System'}
              </strong>
              {msg.isStreaming && <span className="streaming-indicator">●</span>}
            </div>
            <div className="message-content">
              {msg.content}
            </div>
            {/* Apply formula button */}
            {msg.suggested_formula && currentStep && onApplyFormula && (
              <button
                className="apply-formula-btn"
                onClick={() => handleApplyFormula(msg.suggested_formula!)}
                title={`Apply ${msg.suggested_formula} to "${currentStep.label}"`}
              >
                ⚡ Apply: <code>{msg.suggested_formula}</code>
              </button>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="chat-input-area">
        {!agentReady && (
          <div className="agent-setup-hint">
            <span>Agent not configured.</span>
            <button onClick={() => setConfigOpen(true)}>Configure →</button>
          </div>
        )}
        <div className="chat-input-row">
          <textarea
            className="chat-input"
            placeholder={
              agentReady
                ? 'Ask the agent about functions & arguments…'
                : 'Configure the agent to start chatting…'
            }
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isStreaming}
          />
          <button
            className="chat-send-btn"
            onClick={handleSendMessage}
            disabled={isStreaming || !inputValue.trim()}
            title="Send message"
          >
            {isStreaming ? '⏳' : '↑'}
          </button>
        </div>
      </div>

      {/* Config panel (modal) */}
      <AgentConfigPanel isOpen={configOpen} onClose={() => setConfigOpen(false)} />
    </div>
  );
};

export default ChatSidebar;

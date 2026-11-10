/**
 * AgentConfigPanel — the copilot's model: one setting, any LLM that writes
 * text (plan 128, M2). Test connection tries the form as filled in; Save
 * keeps it in ~/.simple_steps/agent.json. A key is write-only: the panel only
 * ever learns whether one is set (C3).
 */

import React, { useEffect, useState } from 'react';
import type { AgentSettings, AgentSettingsPatch, AgentTestResult } from '../services/agentApi';
import { getAgentSettings, saveAgentSettings, testAgentConnection } from '../services/agentApi';
import SymbolIcon from './SymbolIcon';
import './AgentConfigPanel.css';

interface AgentConfigPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type Api = 'openai' | 'anthropic';

const API_OPTIONS: { value: Api; label: string }[] = [
  { value: 'openai', label: 'OpenAI-compatible: OpenAI, Ollama, LM Studio, vLLM, Groq, OpenRouter, …' },
  { value: 'anthropic', label: 'Anthropic (Claude)' },
];

const MODEL_SUGGESTIONS: Record<Api, string[]> = {
  openai: ['llama3.2:3b', 'qwen2.5:7b', 'gpt-4o-mini', 'gpt-4o'],
  anthropic: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'],
};

const BASE_URL_HINT: Record<Api, string> = {
  openai: 'http://localhost:11434/v1 for Ollama, https://api.openai.com/v1 for OpenAI',
  anthropic: 'https://api.anthropic.com',
};

const SOURCE_NOTE: Record<AgentSettings['source'], string> = {
  app: "This App sets the model in its code; change it there.",
  saved: 'Saved for you on this computer.',
  default: 'Nothing saved yet: the copilot uses a local Ollama.',
  off: 'The App turned the copilot off.',
};

const AgentConfigPanel: React.FC<AgentConfigPanelProps> = ({ isOpen, onClose }) => {
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [form, setForm] = useState<AgentSettingsPatch>({});
  /** A key typed here; sent once on Save or Test, never shown back. */
  const [keyInput, setKeyInput] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [result, setResult] = useState<AgentTestResult | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (s: AgentSettings) => {
    setSettings(s);
    setForm({ api: s.api ?? 'openai', model: s.model ?? '', base_url: s.base_url ?? '',
              api_key_env: s.api_key_env ?? '', temperature: s.temperature ?? 0 });
    setKeyInput('');
    setClearKey(false);
  };

  useEffect(() => {
    if (!isOpen) return;
    setResult(null);
    setError(null);
    getAgentSettings().then(load).catch((e) => setError(String(e.message ?? e)));
  }, [isOpen]);

  if (!isOpen) return null;

  const readOnly = settings?.source === 'app' || settings?.source === 'off';
  const api: Api = form.api ?? 'openai';
  const set = (patch: AgentSettingsPatch) => { setForm({ ...form, ...patch }); setResult(null); };
  const withKey = (): AgentSettingsPatch =>
    keyInput ? { ...form, api_key: keyInput } : clearKey ? { ...form, api_key: '' } : form;

  const handleTest = async () => {
    setBusy('test');
    setError(null);
    try {
      setResult(await testAgentConnection(readOnly ? undefined : withKey()));
    } finally {
      setBusy(null);
    }
  };

  const handleSave = async () => {
    setBusy('save');
    setError(null);
    try {
      load(await saveAgentSettings(withKey()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="agent-config-overlay">
      <div className="agent-config-panel" role="dialog" aria-label="Copilot model">
        <div className="agent-config-header">
          <span className="agent-config-title"><SymbolIcon name="settings" /> Copilot model</span>
          <button className="agent-config-close" onClick={onClose} title="Close" aria-label="Close">
            <SymbolIcon name="close" />
          </button>
        </div>

        {settings && <div className="agent-config-source"><SymbolIcon name="info" size={14} /> {SOURCE_NOTE[settings.source]}</div>}
        {error && <div className="agent-config-error">{error}</div>}

        {settings && settings.source !== 'off' && (
          <div className="agent-config-body">
            <div className="config-field">
              <label htmlFor="agent-api">API</label>
              <select id="agent-api" value={api} disabled={readOnly}
                onChange={(e) => set({ api: e.target.value as Api })}>
                {API_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div className="config-field">
              <label htmlFor="agent-model">Model</label>
              <input id="agent-model" type="text" value={form.model ?? ''} disabled={readOnly}
                list="agent-model-suggestions" placeholder="e.g. llama3.2:3b"
                onChange={(e) => set({ model: e.target.value })} />
              <datalist id="agent-model-suggestions">
                {MODEL_SUGGESTIONS[api].map((m) => <option key={m} value={m} />)}
              </datalist>
            </div>

            <div className="config-field">
              <label htmlFor="agent-base-url">Base URL</label>
              <input id="agent-base-url" type="text" value={form.base_url ?? ''} disabled={readOnly}
                placeholder={BASE_URL_HINT[api]} onChange={(e) => set({ base_url: e.target.value })} />
              <span className="config-hint">{BASE_URL_HINT[api]}</span>
            </div>

            <div className="config-field">
              <label htmlFor="agent-key-env">Key</label>
              <input id="agent-key-env" type="text" value={form.api_key_env ?? ''} disabled={readOnly}
                placeholder="environment variable, e.g. OPENAI_API_KEY"
                onChange={(e) => set({ api_key_env: e.target.value })} />
              {!readOnly && (
                <input id="agent-key" type="password" value={keyInput} autoComplete="off"
                  placeholder={settings.api_key_set && !clearKey ? 'A key is set; type to replace it' : 'or paste a key'}
                  onChange={(e) => { setKeyInput(e.target.value); setClearKey(false); setResult(null); }} />
              )}
              <span className="config-hint">
                {settings.api_key_set && !clearKey ? 'A key is set. ' : 'No key set: local servers usually need none. '}
                A pasted key is saved only on this computer, and the copilot never sees it.
                {settings.api_key_set && !readOnly && !clearKey && (
                  <> <button type="button" className="config-link-btn" onClick={() => { setClearKey(true); setKeyInput(''); }}>Clear the key</button></>
                )}
              </span>
            </div>

            <div className="config-field">
              <label htmlFor="agent-temperature">Temperature: {(form.temperature ?? 0).toFixed(1)}</label>
              <input id="agent-temperature" type="range" min="0" max="1" step="0.1" disabled={readOnly}
                value={form.temperature ?? 0} onChange={(e) => set({ temperature: parseFloat(e.target.value) })} />
              <div className="range-labels"><span>Precise</span><span>Varied</span></div>
            </div>

            {result && (
              <div className={`agent-test-result ${result.ok ? 'ok' : 'fail'}`} role="status">
                <SymbolIcon name={result.ok ? 'check_circle' : 'error'} size={15} />
                <span>{result.ok ? `${result.model} answered. ` : ''}{result.detail}</span>
              </div>
            )}

            <div className="config-actions">
              <button className="config-test-btn" onClick={handleTest} disabled={busy !== null}>
                {busy === 'test' ? 'Testing…' : 'Test connection'}
              </button>
              {!readOnly && (
                <button className="config-save-btn" onClick={handleSave} disabled={busy !== null}>
                  {busy === 'save' ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>
          </div>
        )}

        {!settings && !error && <div className="agent-config-loading">Loading…</div>}
      </div>
    </div>
  );
};

export default AgentConfigPanel;

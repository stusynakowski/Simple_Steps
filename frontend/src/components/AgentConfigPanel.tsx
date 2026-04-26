/**
 * AgentConfigPanel — settings panel for the step-definition agent.
 * Allows users to change LLM provider, model, temperature, etc.
 */

import React, { useState, useEffect } from 'react';
import type { AgentConfig, AgentHealthStatus } from '../services/agentApi';
import { getAgentConfig, updateAgentConfig, getAgentHealth } from '../services/agentApi';
import './AgentConfigPanel.css';

interface AgentConfigPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'ollama', label: 'Ollama (Local)' },
  { value: 'azure_openai', label: 'Azure OpenAI' },
] as const;

const MODEL_SUGGESTIONS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  ollama: ['llama3.1', 'llama3', 'mistral', 'codellama', 'deepseek-coder'],
  azure_openai: ['gpt-4o', 'gpt-4', 'gpt-35-turbo'],
};

const AgentConfigPanel: React.FC<AgentConfigPanelProps> = ({ isOpen, onClose }) => {
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [health, setHealth] = useState<AgentHealthStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      loadHealth();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    try {
      const cfg = await getAgentConfig();
      setConfig(cfg);
      setDirty(false);
    } catch {
      setError('Failed to load agent config');
    }
  };

  const loadHealth = async () => {
    try {
      const h = await getAgentHealth();
      setHealth(h);
    } catch {
      setHealth(null);
    }
  };

  const handleChange = (field: keyof AgentConfig, value: unknown) => {
    if (!config) return;
    setConfig({ ...config, [field]: value });
    setDirty(true);
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateAgentConfig(config);
      setConfig(updated);
      setDirty(false);
      await loadHealth();
    } catch {
      setError('Failed to save config');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="agent-config-overlay">
      <div className="agent-config-panel">
        <div className="agent-config-header">
          <span>⚙️ Agent Configuration</span>
          <button className="agent-config-close" onClick={onClose}>✕</button>
        </div>

        {/* Health status */}
        {health && (
          <div className={`agent-health-banner ${health.ready ? 'ready' : 'not-ready'}`}>
            <span className="health-dot" />
            {health.ready ? 'Agent ready' : 'Agent not configured'}
            {!health.provider_package && health.install_hint && (
              <span className="health-hint"> — {health.install_hint}</span>
            )}
          </div>
        )}

        {error && <div className="agent-config-error">{error}</div>}

        {config && (
          <div className="agent-config-body">
            {/* Provider */}
            <div className="config-field">
              <label>LLM Provider</label>
              <select
                value={config.provider}
                onChange={e => handleChange('provider', e.target.value)}
              >
                {PROVIDER_OPTIONS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            {/* Model */}
            <div className="config-field">
              <label>Model</label>
              <input
                type="text"
                value={config.model}
                onChange={e => handleChange('model', e.target.value)}
                list="model-suggestions"
                placeholder="e.g. gpt-4o"
              />
              <datalist id="model-suggestions">
                {(MODEL_SUGGESTIONS[config.provider] ?? []).map(m => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>

            {/* API Key */}
            {config.provider !== 'ollama' && (
              <div className="config-field">
                <label>API Key</label>
                <input
                  type="password"
                  value={config.api_key ?? ''}
                  onChange={e => handleChange('api_key', e.target.value || null)}
                  placeholder="Set via env var or enter here"
                />
                <span className="config-hint">
                  Or set the environment variable (e.g. OPENAI_API_KEY)
                </span>
              </div>
            )}

            {/* Base URL */}
            {(config.provider === 'ollama' || config.provider === 'azure_openai') && (
              <div className="config-field">
                <label>Base URL</label>
                <input
                  type="text"
                  value={config.base_url ?? ''}
                  onChange={e => handleChange('base_url', e.target.value || null)}
                  placeholder={config.provider === 'ollama' ? 'http://localhost:11434' : 'https://your-resource.openai.azure.com/'}
                />
              </div>
            )}

            {/* Temperature */}
            <div className="config-field">
              <label>Temperature: {config.temperature.toFixed(1)}</label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={config.temperature}
                onChange={e => handleChange('temperature', parseFloat(e.target.value))}
              />
              <div className="range-labels">
                <span>Precise</span>
                <span>Creative</span>
              </div>
            </div>

            {/* Max Tokens */}
            <div className="config-field">
              <label>Max Tokens: {config.max_tokens}</label>
              <input
                type="range"
                min="128"
                max="16384"
                step="128"
                value={config.max_tokens}
                onChange={e => handleChange('max_tokens', parseInt(e.target.value))}
              />
            </div>

            {/* Feature flags */}
            <div className="config-field checkbox-field">
              <label>
                <input
                  type="checkbox"
                  checked={config.auto_suggest}
                  onChange={e => handleChange('auto_suggest', e.target.checked)}
                />
                Auto-suggest functions for new steps
              </label>
            </div>

            <div className="config-field checkbox-field">
              <label>
                <input
                  type="checkbox"
                  checked={config.show_reasoning}
                  onChange={e => handleChange('show_reasoning', e.target.checked)}
                />
                Show agent reasoning in chat
              </label>
            </div>

            {/* System prompt override */}
            <div className="config-field">
              <label>System Prompt Override</label>
              <textarea
                value={config.system_prompt_override ?? ''}
                onChange={e => handleChange('system_prompt_override', e.target.value || null)}
                placeholder="Leave empty to use the default system prompt"
                rows={4}
              />
            </div>

            {/* Save button */}
            <div className="config-actions">
              <button
                className="config-save-btn"
                onClick={handleSave}
                disabled={!dirty || saving}
              >
                {saving ? 'Saving…' : dirty ? 'Save Changes' : 'Saved'}
              </button>
            </div>
          </div>
        )}

        {!config && !error && (
          <div className="agent-config-loading">Loading configuration…</div>
        )}
      </div>
    </div>
  );
};

export default AgentConfigPanel;

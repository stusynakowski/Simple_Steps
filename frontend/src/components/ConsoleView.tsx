/**
 * ConsoleView — the console's record list plus its prompt.
 *
 * Renders one stream of `ConsoleContext` (commands, wire traffic, or results)
 * and, on the Python tab, accepts input. A typed line is either:
 *
 *   command     applied client-side via `dispatchCommand`, i.e. the exact
 *               path a GUI click takes — which is what makes the two
 *               directions structurally identical rather than mirrored
 *   expression  sent to /api/console/eval and evaluated by safe_formula
 *
 * See docs/dev_plan/118-console-and-gui-parity.md.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useConsole, type ConsoleStream } from '../context/ConsoleContext';
import { parseConsoleLine } from '../utils/consoleParser';
import { COMMAND_HELP } from '../types/commands';
import { evalConsole } from '../services/api';
import type { WorkflowCommand } from '../types/commands';
import './ConsoleView.css';

interface ConsoleViewProps {
  /** Which stream to show. 'prompt' shows results and accepts input. */
  view: 'command' | 'wire' | 'prompt';
  dispatchCommand: (cmd: WorkflowCommand) => Promise<string>;
  consoleStepMap: () => Record<string, string>;
}

function hhmmss(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function ConsoleView({ view, dispatchCommand, consoleStepMap }: ConsoleViewProps) {
  const { records, emit, clear } = useConsole();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyAt, setHistoryAt] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const streams: ConsoleStream[] = useMemo(
    () => (view === 'wire' ? ['wire'] : view === 'command' ? ['command'] : ['command', 'result']),
    [view],
  );
  const shown = useMemo(
    () => records.filter((r) => streams.includes(r.stream)),
    [records, streams],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [shown.length]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  async function submit() {
    const line = input.trim();
    if (!line || busy) return;
    setHistory((h) => [...h, line]);
    setHistoryAt(null);
    setInput('');

    const parsed = parseConsoleLine(line);

    if (parsed.kind === 'meta') {
      if (parsed.name === 'clear') { clear(); return; }
      emit({ stream: 'result', origin: 'console', text: `> ${line}` });
      if (parsed.name === 'help') {
        emit({
          stream: 'result',
          text: 'Commands',
          detail: COMMAND_HELP.map((h) => `  ${h.form.padEnd(44)} ${h.what}`).join('\n'),
        });
      } else {
        const map = consoleStepMap();
        const names = Object.keys(map).filter((k) => /^step\d+$/.test(k)).sort();
        emit({
          stream: 'result',
          text: names.length ? `${names.length} step(s) with output` : 'No steps have run yet.',
          detail: names.length ? names.join('\n') : undefined,
        });
      }
      return;
    }

    emit({ stream: 'result', origin: 'console', text: `> ${line}` });

    if (parsed.kind === 'error') {
      emit({ stream: 'result', level: 'error', text: parsed.message });
      return;
    }

    setBusy(true);
    try {
      if (parsed.kind === 'command') {
        // dispatchCommand announces the command itself, so the transcript
        // records it in exactly the form a GUI click would have produced.
        const confirmation = await dispatchCommand(parsed.command);
        emit({ stream: 'result', text: confirmation });
      } else {
        const res = await evalConsole(parsed.source, consoleStepMap());
        if (res.ok) {
          emit({
            stream: 'result',
            text: `${res.kind}${res.shape ? `  ${res.shape}` : ''}`,
            detail: (res.repr ?? '') + (res.truncated ? '\n… truncated' : ''),
          });
        } else {
          emit({
            stream: 'result',
            level: 'error',
            text: res.error ?? 'Evaluation failed.',
            detail: res.available_steps?.length
              ? `Available steps: ${res.available_steps.join(', ')}`
              : undefined,
          });
        }
      }
    } catch (e) {
      emit({ stream: 'result', level: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); void submit(); return; }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!history.length) return;
      const next = historyAt === null ? history.length - 1 : Math.max(0, historyAt - 1);
      setHistoryAt(next);
      setInput(history[next]);
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyAt === null) return;
      const next = historyAt + 1;
      if (next >= history.length) { setHistoryAt(null); setInput(''); }
      else { setHistoryAt(next); setInput(history[next]); }
    }
  }

  const emptyHint =
    view === 'wire'
      ? 'No requests yet. Run a step to see the exact payload sent to /api/run.'
      : view === 'command'
        ? 'No commands yet. Edit a formula or run a step — the command appears here.'
        : 'Type help for commands, or an expression like step1["score"].';

  return (
    <div className="console-view">
      <div className="console-records">
        {shown.length === 0 && <div className="console-empty">{emptyHint}</div>}
        {shown.map((r) => {
          const open = expanded.has(r.id);
          return (
            <div
              key={r.id}
              className={`console-rec stream-${r.stream}${r.level === 'error' ? ' is-error' : ''}`}
              onClick={() => r.detail && toggle(r.id)}
              style={{ cursor: r.detail ? 'pointer' : 'default' }}
            >
              <div className="console-rec-main">
                <span className="console-time">{hhmmss(r.timestamp)}</span>
                {r.origin && (
                  <span className={`console-origin origin-${r.origin}`}>
                    {r.origin === 'gui' ? 'GUI' : '›_'}
                  </span>
                )}
                <span className="console-text">{r.text}</span>
                {r.durationMs != null && <span className="console-ms">{r.durationMs}ms</span>}
                {r.detail && <span className="console-caret">{open ? '▾' : '▸'}</span>}
              </div>
              {open && r.detail && <pre className="console-detail">{r.detail}</pre>}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {view === 'prompt' && (
        <div className="console-prompt">
          <span className="console-chevron">›</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            disabled={busy}
            spellCheck={false}
            autoComplete="off"
            placeholder={busy ? 'running…' : 'wf["step2"] = \'=op(…)\'   ·   step1["score"]   ·   help'}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            data-testid="console-input"
          />
        </div>
      )}
    </div>
  );
}

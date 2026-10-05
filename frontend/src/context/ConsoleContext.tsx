/**
 * ConsoleContext — the console's record store.
 *
 * Three streams share one store, kept distinguishable by `stream` rather than
 * merged (`docs/dev_plan/118-console-and-gui-parity.md` §3):
 *
 *   command  the canonical form of a user action, from either direction
 *   wire     the real request/response at the fetch boundary
 *   result   output of an expression evaluated against live data
 *
 * `wire` records are emitted by `services/api.ts` itself, not reconstructed
 * from state. A reconstruction is a *model* of what was sent; if it drifts it
 * reports a parity that does not exist, which is the failure this whole
 * feature is meant to rule out.
 *
 * Because `services/api.ts` is a plain module with no React context available,
 * the wire tap writes through a module-level sink that the provider installs
 * on mount. That keeps the API layer free of React while still funnelling
 * everything into one store.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export type ConsoleStream = 'command' | 'wire' | 'result';

export interface ConsoleRecord {
  id: string;
  timestamp: string;
  stream: ConsoleStream;
  /** Where a command came from. Absent for non-command records. */
  origin?: 'gui' | 'console';
  /** The canonical one-liner, the request line, or the echoed expression. */
  text: string;
  /** Expanded body: a payload, a rendered value, a traceback. */
  detail?: string;
  level?: 'info' | 'error';
  durationMs?: number;
}

interface ConsoleContextValue {
  records: ConsoleRecord[];
  emit: (rec: Omit<ConsoleRecord, 'id' | 'timestamp'>) => void;
  clear: () => void;
}

const ConsoleContext = createContext<ConsoleContextValue>({
  records: [],
  emit: () => {},
  clear: () => {},
});

/** Cap so a long session cannot grow the store without bound. */
const MAX_RECORDS = 1000;

// ── Module-level sink, so non-React callers (services/api.ts) can emit ──────
type Sink = (rec: Omit<ConsoleRecord, 'id' | 'timestamp'>) => void;
let sink: Sink | null = null;

/** Called by the API layer. A no-op until a provider mounts. */
export function emitConsoleRecord(rec: Omit<ConsoleRecord, 'id' | 'timestamp'>) {
  sink?.(rec);
}

let seq = 0;

export function ConsoleProvider({ children }: { children: React.ReactNode }) {
  const [records, setRecords] = useState<ConsoleRecord[]>([]);
  const mounted = useRef(true);

  const emit = useCallback((rec: Omit<ConsoleRecord, 'id' | 'timestamp'>) => {
    if (!mounted.current) return;
    setRecords((prev) => {
      const next = [
        ...prev,
        { ...rec, id: `c${seq++}`, timestamp: new Date().toISOString() },
      ];
      return next.length > MAX_RECORDS ? next.slice(next.length - MAX_RECORDS) : next;
    });
  }, []);

  const clear = useCallback(() => setRecords([]), []);

  useEffect(() => {
    mounted.current = true;
    sink = emit;
    return () => {
      mounted.current = false;
      sink = null;
    };
  }, [emit]);

  const value = useMemo(() => ({ records, emit, clear }), [records, emit, clear]);
  return <ConsoleContext.Provider value={value}>{children}</ConsoleContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConsole() {
  return useContext(ConsoleContext);
}

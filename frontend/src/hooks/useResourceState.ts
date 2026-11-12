import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Step } from '../types/models';
import {
  clearResource,
  fetchLoadedResources,
  fetchResourceStatus,
  fetchResourceTypes,
  loadResource,
  type LoadedResourceInfo,
  type ResourceDeclaration,
  type ResourceTypeInfo,
} from '../services/api';
import { loadedProblem } from '../utils/resources';

/**
 * What the resource column and the workflow overview know about the
 * workflow's resources (spec 017): the app's types, the deployment's
 * ready-made resources, and whether each one is loaded in this session.
 */

export type ResourceStatusKind = 'not_loaded' | 'loaded' | 'error' | 'changed' | 'missing' | 'busy';

export interface ResourceStatus {
  kind: ResourceStatusKind;
  /** What the dot's tooltip and the panel say. */
  detail: string;
}

export const STATUS_TEXT: Record<ResourceStatusKind, string> = {
  not_loaded: 'Not loaded',
  loaded: 'Loaded',
  error: 'Error',
  changed: 'Changed by the deployment',
  missing: 'Missing',
  busy: 'Working…',
};

/** Error, changed or missing: what "needs attention" means (REQ-RES-012). */
export const needsAttention = (s: ResourceStatus) => s.kind === 'error' || s.kind === 'changed' || s.kind === 'missing';

export function useResourceState(resources: Record<string, unknown> | undefined, steps: Step[]) {
  const [types, setTypes] = useState<Record<string, ResourceTypeInfo>>({});
  const [loaded, setLoaded] = useState<Record<string, LoadedResourceInfo>>({});
  const [live, setLive] = useState<Record<string, boolean | string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});

  const declarations = useMemo(
    () => (resources ?? {}) as Record<string, ResourceDeclaration>, [resources]);
  const declKey = JSON.stringify(declarations);
  // A step's run builds the objects it uses, so a run can change what's loaded.
  const runKey = steps.map((s) => s.status).join(',');

  useEffect(() => {
    fetchResourceTypes().then(setTypes).catch(() => setTypes({}));
    fetchLoadedResources().then(setLoaded).catch(() => setLoaded({}));
  }, []);

  const refreshStatus = useCallback(() => {
    if (!Object.keys(declarations).length) { setLive({}); return; }
    fetchResourceStatus(declarations).then(setLive).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declKey]);

  useEffect(() => { refreshStatus(); }, [refreshStatus, runKey]);

  const typesKnown = Object.keys(types).length > 0;

  const statusOf = useCallback((name: string): ResourceStatus => {
    const decl = declarations[name];
    if (busy[name]) return { kind: 'busy', detail: STATUS_TEXT.busy };
    if (!decl) return { kind: 'missing', detail: 'Not in this workflow' };
    if (typesKnown && !(decl.type in types)) {
      return { kind: 'error', detail: `This app has no resource type ${decl.type}` };
    }
    const problem = loadedProblem(decl, loaded[name]);
    if (problem) return { kind: problem.kind, detail: problem.detail };
    if (failed[name]) return { kind: 'error', detail: failed[name] };
    const state = live[name];
    if (typeof state === 'string') return { kind: 'error', detail: state };
    return state
      ? { kind: 'loaded', detail: 'Loaded in this session' }
      : { kind: 'not_loaded', detail: 'Not loaded yet: Load builds it, or a step does on first use' };
  }, [declarations, busy, typesKnown, types, loaded, failed, live]);

  /** Load / Clear / Refresh (REQ-RES-009). A failure shows on the resource. */
  const act = useCallback(async (name: string, action: 'load' | 'clear' | 'refresh') => {
    const decl = declarations[name];
    if (!decl) return;
    setBusy((b) => ({ ...b, [name]: true }));
    setFailed(({ [name]: _gone, ...rest }) => { void _gone; return rest; });
    try {
      if (action !== 'load') await clearResource(name, decl);
      if (action !== 'clear') await loadResource(name, decl);
    } catch (e) {
      setFailed((f) => ({ ...f, [name]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(({ [name]: _done, ...rest }) => { void _done; return rest; });
      refreshStatus();
    }
  }, [declarations, refreshStatus]);

  const names = Object.keys(declarations);
  const summary = {
    total: names.length,
    loaded: names.filter((n) => statusOf(n).kind === 'loaded').length,
    attention: names.filter((n) => needsAttention(statusOf(n))).length,
    /** Each resource and where it stands, for the workflow overview. */
    items: names.map((name) => ({ name, status: statusOf(name) })),
  };

  return { types, loaded, statusOf, act, summary };
}

export type ResourceState = ReturnType<typeof useResourceState>;

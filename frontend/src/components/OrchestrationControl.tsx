import { useEffect, useState } from "react";
import { getModifiers } from "../services/api";
import type { ModifierInfo, ModifierSetting } from "../services/api";

/**
 * Which core verb a tool runs under, and that verb's settings.
 *
 * The verb list and each verb's settings come from ``GET /api/modifiers``
 * (``grid.modifier_catalog()`` in simple-steps-core), so this control cannot
 * drift from what the backend runs. Values are stored in the step's
 * configuration as ``_``-prefixed keys — ``_orchestrator`` for the verb,
 * ``_name`` / ``_by`` / ``_initial`` … for its settings, ``_retry`` /
 * ``_timeout`` for the execution modifiers — which ``grid_runner.py`` turns
 * into core's operation JSON.
 */

/** Verbs that apply a tool. The tool-less ones (select, sort, …) are palette
 *  operations of their own, not a way to run a tool. */
const TOOL_VERBS = [
  "map",
  "filter",
  "group",
  "expand",
  "collapse",
  "sweep",
  "source",
];

const VERB_HELP: Record<string, string> = {
  source: "call the tool once — no input",
  map: "once per row, adding a column",
  filter: "keep the rows where it returns True",
  group: "a key per row, for a later collapse",
  expand: "one row per item it returns",
  collapse: "reduce to one row (or one per group)",
  sweep: "every combination of list arguments",
};

/** Settings the control does not show: `over` is the step reference in the
 *  formula; the rest are core internals or set elsewhere. */
const HIDDEN_SETTINGS = new Set(["over", "retries", "axis"]);

type Config = Record<string, unknown>;

interface Props {
  configuration: Config;
  /** The tool's registered default mode, shown in the "Default" label. */
  defaultType?: string;
  onChange: (next: Config) => void;
}

export default function OrchestrationControl({
  configuration,
  defaultType,
  onChange,
}: Props) {
  const [modifiers, setModifiers] = useState<Record<
    string,
    ModifierInfo
  > | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getModifiers()
      .then((m) => {
        if (!cancelled) setModifiers(m);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const verb = String(configuration._orchestrator || "");
  const verbs = modifiers ? TOOL_VERBS.filter((v) => v in modifiers) : [];
  const settings: ModifierSetting[] = (
    (verb && modifiers?.[verb]?.settings) ||
    []
  ).filter((s) => !HIDDEN_SETTINGS.has(s.name) && !s.name.startsWith("<"));

  const setVerb = (next: string) => {
    const updated: Config = { ...configuration };
    // Drop the previous verb's settings so they cannot leak into the new one.
    for (const s of modifiers?.[verb]?.settings ?? [])
      delete updated[`_${s.name}`];
    if (next) updated._orchestrator = next;
    else delete updated._orchestrator;
    onChange(updated);
  };

  const setKey = (key: string, value: string) => {
    const updated: Config = { ...configuration };
    if (value === "") delete updated[key];
    else updated[key] = value;
    onChange(updated);
  };

  const legacy =
    verb && !verbs.includes(verb) && verb !== "dataframe" ? verb : null;

  return (
    // Each row is its own `.config-item` (a flex row in OperationColumn.css);
    // nesting them would squeeze the whole control onto one line.
    <div
      style={{
        borderTop: "1px solid #eee",
        paddingTop: "10px",
        marginTop: "10px",
      }}
    >
      <div className="config-item">
        <label>Orchestration:</label>
        <select
          value={verb}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation();
            setVerb(e.target.value);
          }}
        >
          <option value="">
            Default — core infers it from the tool
            {defaultType ? ` (registered: ${defaultType})` : ""}
          </option>
          {verbs.map((v) => (
            <option key={v} value={v}>
              {v} — {VERB_HELP[v] ?? modifiers?.[v]?.row_rule ?? ""}
            </option>
          ))}
          <option value="dataframe">
            whole table — hand the tool the entire input (legacy)
          </option>
          {legacy && <option value={legacy}>{legacy} (older mode)</option>}
        </select>
      </div>
      {error && (
        <div className="config-hint" style={{ color: "#b00" }}>
          Could not load core's verbs: {error}
        </div>
      )}

      {settings.map((s) => (
        <div key={s.name} className="config-item">
          <label title={s.description || ""}>{s.name}:</label>
          <input
            type="text"
            value={String(configuration[`_${s.name}`] ?? "")}
            placeholder={
              s.default === null || s.default === undefined
                ? s.required
                  ? "required"
                  : ""
                : String(s.default)
            }
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setKey(`_${s.name}`, e.target.value)}
          />
        </div>
      ))}

      {verb && verb !== "dataframe" && (
        <>
          <div className="config-item">
            <label title="Retry each failing unit this many times">
              retry:
            </label>
            <input
              type="number"
              min={0}
              value={String(configuration._retry ?? "")}
              placeholder="0"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setKey("_retry", e.target.value)}
            />
          </div>
          <div className="config-item">
            <label title="Seconds per unit. Recorded by core; not enforced until core's async engine lands.">
              timeout:
            </label>
            <input
              type="number"
              min={0}
              value={String(configuration._timeout ?? "")}
              placeholder="none"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setKey("_timeout", e.target.value)}
            />
          </div>
        </>
      )}
    </div>
  );
}

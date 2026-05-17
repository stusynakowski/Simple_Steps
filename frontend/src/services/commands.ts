/**
 * Application-wide command registry (S0.5).
 *
 * Wraps `@lumino/commands`'s `CommandRegistry` as a singleton so any feature
 * can register / execute / list commands without prop-drilling.  This is the
 * same primitive JupyterLab and VS Code's command system are modelled on:
 *
 *   - A command has a stable string `id` (e.g. `workflow.run`, `step.delete`).
 *   - Each command has a label, optional icon, optional `isEnabled`, and an
 *     `execute(args)` function.
 *   - UI surfaces (command palette, menus, keybindings, context menus,
 *     toolbars) all bind to the same `id` so they stay in sync.
 *
 * In M0 (single user, local) this lives entirely in the browser tab.  When we
 * graduate to M1 (hosted), the registry stays client-side; only the
 * `execute()` bodies will fan out to backend `/api/*` calls — no change to
 * call sites.
 *
 * Usage:
 *
 *   import { commands } from '@/services/commands';
 *
 *   commands.addCommand('workflow.run', {
 *     label: 'Run Workflow',
 *     icon: 'play',
 *     execute: () => runActiveWorkflow(),
 *   });
 *
 *   commands.execute('workflow.run');
 *
 * Keybindings (S0.6+) and the cmdk palette (S0.6) both read from this
 * singleton — never register commands at the UI layer.
 */

import { CommandRegistry } from '@lumino/commands';
import type { ReadonlyPartialJSONObject } from '@lumino/coreutils';

// ── Singleton ──────────────────────────────────────────────────────────────

export const commands = new CommandRegistry();

// ── Convenience types ──────────────────────────────────────────────────────

/** Shape of the metadata we attach to every command we register. */
export interface SimpleStepsCommand {
  /** Human-readable label shown in palette / menus. */
  label: string;
  /** Optional codicon name (without the `codicon-` prefix). */
  icon?: string;
  /** Optional one-line description shown in palette. */
  caption?: string;
  /** Optional grouping bucket for the palette (e.g. "Workflow", "View"). */
  category?: string;
  /** Optional keybinding hint string (purely cosmetic, shown in palette). */
  keybinding?: string;
  /** The actual handler. */
  execute: (args?: Record<string, unknown>) => void | Promise<void>;
  /** Optional gate — return false to grey out the command. */
  isEnabled?: () => boolean;
}

/**
 * Register a command with our standard metadata shape.  Returns the
 * Lumino `IDisposable` so callers can `.dispose()` on unmount.
 */
export function registerCommand(id: string, cmd: SimpleStepsCommand) {
  return commands.addCommand(id, {
    label: cmd.label,
    caption: cmd.caption ?? cmd.label,
    iconClass: cmd.icon ? `codicon codicon-${cmd.icon}` : undefined,
    execute: (args) => cmd.execute(args as Record<string, unknown> | undefined),
    isEnabled: cmd.isEnabled,
    // Stash extras on the command's `mnemonic`-adjacent free-form slots via
    // a side map — Lumino doesn't expose custom metadata officially.
    ...(cmd.category ? { className: `cat-${cmd.category}` } : {}),
  });
}

/**
 * Side-table for metadata Lumino doesn't store natively (category, keybinding
 * hint).  Keyed by command id.
 */
const meta = new Map<string, { category?: string; keybinding?: string }>();

export function setCommandMeta(id: string, m: { category?: string; keybinding?: string }) {
  meta.set(id, { ...meta.get(id), ...m });
}

export function getCommandMeta(id: string) {
  return meta.get(id) ?? {};
}

/**
 * Return every registered command id, optionally filtered by category.
 * Used by the cmdk palette in S0.6.
 */
export function listCommands(category?: string): string[] {
  const ids = commands.listCommands();
  if (!category) return ids;
  return ids.filter((id) => meta.get(id)?.category === category);
}

/**
 * Execute a command by id.  Thin wrapper that swallows the "unknown command"
 * error and logs it, so a stale keybinding or palette entry can't crash the
 * shell.
 */
export async function runCommand(id: string, args?: Record<string, unknown>) {
  if (!commands.hasCommand(id)) {
    console.warn(`[commands] no such command: ${id}`);
    return;
  }
  try {
    await commands.execute(id, args as ReadonlyPartialJSONObject | undefined);
  } catch (err) {
    console.error(`[commands] ${id} failed:`, err);
  }
}

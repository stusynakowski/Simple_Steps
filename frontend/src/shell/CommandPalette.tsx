/**
 * Command Palette (S0.6).
 *
 * Thin wrapper around `cmdk` that:
 *   1. opens on ⌘⇧P (or Ctrl+Shift+P on Linux/Win),
 *   2. lists every command registered with our Lumino-backed registry
 *      (`@/services/commands`),
 *   3. dispatches via `runCommand(id)` on Enter.
 *
 * No commands are registered yet — that lands incrementally in later
 * sprints.  Today the palette will say "No commands match." which is the
 * intended S0.6 deliverable: the wiring is real, the catalog is empty.
 */

import { useEffect, useState, useMemo } from 'react';
import { Command } from 'cmdk';
import { commands, runCommand, getCommandMeta } from '../services/commands';
import Icon from '../components/Icon';
import './CommandPalette.css';

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Global hotkey: ⌘⇧P / Ctrl+Shift+P.  Also closes on Esc (cmdk handles
  // that internally but we still listen so the toggle works from any focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Re-read the command list each time the palette opens so newly-registered
  // commands appear without us needing to subscribe to the registry.
  const items = useMemo(() => {
    if (!open) return [];
    return commands.listCommands().map((id) => ({
      id,
      label: commands.label(id) || id,
      caption: commands.caption(id),
      iconClass: commands.iconClass(id),
      meta: getCommandMeta(id),
      enabled: commands.isEnabled(id),
    }));
  }, [open]);

  const handleSelect = async (id: string) => {
    setOpen(false);
    setSearch('');
    await runCommand(id);
  };

  if (!open) return null;

  return (
    <div className="cmd-palette-overlay" onClick={() => setOpen(false)}>
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()}>
        <Command label="Command Palette" shouldFilter>
          <div className="cmd-palette-input-row">
            <Icon name="chevron-right" size={14} color="#888" />
            <Command.Input
              autoFocus
              placeholder="Type a command…"
              value={search}
              onValueChange={setSearch}
            />
            <kbd className="cmd-palette-kbd">esc</kbd>
          </div>

          <Command.List className="cmd-palette-list">
            <Command.Empty className="cmd-palette-empty">
              {items.length === 0
                ? 'No commands registered yet.'
                : 'No commands match.'}
            </Command.Empty>

            {items.map((cmd) => (
              <Command.Item
                key={cmd.id}
                value={`${cmd.label} ${cmd.id} ${cmd.meta.category ?? ''}`}
                disabled={!cmd.enabled}
                onSelect={() => handleSelect(cmd.id)}
                className="cmd-palette-item"
              >
                {cmd.iconClass ? (
                  <span className={cmd.iconClass} style={{ fontSize: 14 }} />
                ) : (
                  <span style={{ display: 'inline-block', width: 14 }} />
                )}
                <span className="cmd-palette-label">{cmd.label}</span>
                {cmd.meta.category && (
                  <span className="cmd-palette-category">{cmd.meta.category}</span>
                )}
                {cmd.meta.keybinding && (
                  <kbd className="cmd-palette-kbd">{cmd.meta.keybinding}</kbd>
                )}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

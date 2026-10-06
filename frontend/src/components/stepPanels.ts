/**
 * The widgets a step can show under its formula bar. Any number can be open
 * at once (the toolbar buttons toggle them); each open one can be collapsed to
 * its name bar.
 */
export type PanelId = 'overview' | 'data' | 'settings' | 'details';

/**
 * Top-to-bottom order of open widgets — fixed, whatever order they were
 * opened in. `StepWidget` takes its position from this list (CSS `order`),
 * so this is the one place to change it.
 */
export const PANEL_ORDER: PanelId[] = ['overview', 'settings', 'details', 'data'];

export const PANEL_META: Record<PanelId, { name: string; accent: string }> = {
  overview: { name: 'Analytics', accent: '#f39c12' },
  data:     { name: 'Data',      accent: '#9b59b6' },
  settings: { name: 'Settings',  accent: '#7f8c8d' },
  details:  { name: 'Formula',   accent: '#4ea1ff' },
};

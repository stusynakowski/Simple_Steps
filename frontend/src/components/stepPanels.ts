/**
 * The widgets a step can show under its formula bar. Any number can be open
 * at once (the toolbar buttons toggle them); each open one can be collapsed to
 * its name bar. Widgets stack in toolbar order: Analytics, Data, Settings,
 * Formula.
 */
export type PanelId = 'overview' | 'data' | 'settings' | 'details';

export const PANEL_META: Record<PanelId, { name: string; accent: string }> = {
  overview: { name: 'Analytics', accent: '#f39c12' },
  data:     { name: 'Data',      accent: '#9b59b6' },
  settings: { name: 'Settings',  accent: '#7f8c8d' },
  details:  { name: 'Formula',   accent: '#4ea1ff' },
};

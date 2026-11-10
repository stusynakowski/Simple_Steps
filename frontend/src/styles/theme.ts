/**
 * Step colours (owner, 2026-11-10): a palette colours every step that has no
 * colour of its own. The palettes are the server's (settings.py: the
 * built-ins and the app's own); which one is in use is a System Setting.
 *
 * - a list of colours is used in turn: step 1 the first, step 2 the second, …
 * - `{ gradient: [first, …, last] }` is blended along the workflow: its first
 *   step the first colour, its last step the last.
 */
export type StepPalette = string[] | { gradient: string[] };

/** Before the palettes arrive (and if they can't): a neutral grey. */
const NO_PALETTE = '#5c6370';

/** The colour of step *index* (0-based) in a workflow of *count* steps. */
export function paletteColor(palette: StepPalette | undefined, index: number, count: number): string {
  if (!palette) return NO_PALETTE;
  if (Array.isArray(palette)) return palette.length ? palette[index % palette.length] : NO_PALETTE;
  const stops = palette.gradient;
  if (stops.length < 2) return stops[0] ?? NO_PALETTE;
  const t = count > 1 ? Math.min(1, Math.max(0, index / (count - 1))) : 0;
  const at = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(at));
  return mix(stops[i], stops[i + 1], at - i);
}

/** *a* to *b*, a fraction *t* of the way (both #rrggbb). */
function mix(a: string, b: string, t: number): string {
  const ch = (hex: string, k: number) => parseInt(hex.slice(1 + 2 * k, 3 + 2 * k), 16);
  return '#' + [0, 1, 2]
    .map((k) => Math.round(ch(a, k) + (ch(b, k) - ch(a, k)) * t).toString(16).padStart(2, '0'))
    .join('');
}

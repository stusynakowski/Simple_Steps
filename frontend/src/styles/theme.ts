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

/** A palette's tones, in order: its colours, or its gradient's stops. */
export function paletteTones(palette: StepPalette | undefined): string[] {
  if (!palette) return [NO_PALETTE];
  return Array.isArray(palette) ? palette : palette.gradient;
}

/**
 * The colour of step *index* (0-based) in a workflow of *count* steps
 * (*index* may fall between steps). One palette, blended smoothly along the
 * workflow, its tones as the stops (owner, 2026-11-18: "pick a color palette
 * and then have smooth transitions between each tone"), so steps and their
 * groups read as one scheme.
 */
export function paletteColor(palette: StepPalette | undefined, index: number, count: number): string {
  const stops = paletteTones(palette);
  if (stops.length < 2) return stops[0] ?? NO_PALETTE;
  const t = count > 1 ? Math.min(1, Math.max(0, index / (count - 1))) : 0;
  const at = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(at));
  return mix(stops[i], stops[i + 1], at - i);
}

/**
 * A group's tone (dev_plan/141): the palette's colour where the group sits,
 * deeper, so its half of the header is its steps' scheme but never their
 * exact colour.
 */
export function deepen(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? mix(color, '#0d0d12', 0.38) : color;
}

/** *a* to *b*, a fraction *t* of the way (both #rrggbb). */
function mix(a: string, b: string, t: number): string {
  const ch = (hex: string, k: number) => parseInt(hex.slice(1 + 2 * k, 3 + 2 * k), 16);
  return '#' + [0, 1, 2]
    .map((k) => Math.round(ch(a, k) + (ch(b, k) - ch(a, k)) * t).toString(16).padStart(2, '0'))
    .join('');
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchSettings, updateSettings } from '../services/api';
import { paletteColor } from '../styles/theme';
import type { StepPalette } from '../styles/theme';

/**
 * The step palette in use, app-wide (owner, 2026-11-10): the server's
 * `step_palette` setting (an App's default, switched in System Settings) and
 * the palettes on offer. Steps read their colour from it; Settings changes it.
 */
interface StepPaletteValue {
  /** The palette in use, by name. */
  name: string;
  /** Every palette on offer, by name. */
  palettes: Record<string, StepPalette>;
  /** Use another palette (saved as the server's setting). */
  choose: (name: string) => Promise<void>;
}

const StepPaletteContext = createContext<StepPaletteValue>({
  name: '', palettes: {}, choose: async () => {},
});

export function StepPaletteProvider({ children }: { children: ReactNode }) {
  const [name, setName] = useState('');
  const [palettes, setPalettes] = useState<Record<string, StepPalette>>({});
  useEffect(() => {
    fetchSettings()
      .then((s) => { setName(s.step_palette); setPalettes(s.step_palettes ?? {}); })
      .catch(() => {});   // no server: steps stay a neutral grey
  }, []);
  const choose = useCallback(async (next: string) => {
    const s = await updateSettings({ step_palette: next });
    setName(s.step_palette);
    setPalettes(s.step_palettes ?? {});
  }, []);
  const value = useMemo(() => ({ name, palettes, choose }), [name, palettes, choose]);
  return <StepPaletteContext.Provider value={value}>{children}</StepPaletteContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useStepPalette = () => useContext(StepPaletteContext);

/** The colour of step *index* (0-based) of *count*, from the palette in use. */
// eslint-disable-next-line react-refresh/only-export-components
export function useStepColor(): (index: number, count: number) => string {
  const { name, palettes } = useContext(StepPaletteContext);
  const palette = palettes[name];
  return useCallback((index: number, count: number) => paletteColor(palette, index, count), [palette]);
}

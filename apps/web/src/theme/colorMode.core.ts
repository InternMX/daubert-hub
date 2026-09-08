import { createContext, useContext } from 'react';

export type ColorMode = 'light' | 'dark';

// Only the appearance preference is ever stored here — never user data,
// authentication data, session information, or tokens (those live in their
// own dedicated places; see auth/AuthContext.tsx and sessionEvents.ts).
export const COLOR_MODE_STORAGE_KEY = 'daubertHub.colorMode';

const validModes = new Set<ColorMode>(['light', 'dark']);

// Missing or invalid stored values default to 'light' — existing users must
// never see an unexpected appearance change from a value they never set.
export function readStoredColorMode(): ColorMode {
  try {
    const stored = localStorage.getItem(COLOR_MODE_STORAGE_KEY);
    return stored !== null && validModes.has(stored as ColorMode) ? (stored as ColorMode) : 'light';
  } catch {
    // Storage unavailable (private browsing, disabled storage, etc.) — the
    // in-memory default still applies for this session.
    return 'light';
  }
}

export function writeStoredColorMode(mode: ColorMode): void {
  try {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, mode);
  } catch {
    /* Best-effort only — the in-memory mode still applies for this session. */
  }
}

export interface ColorModeContextValue {
  mode: ColorMode;
  toggleColorMode: () => void;
}

export const ColorModeContext = createContext<ColorModeContextValue | undefined>(undefined);

export function useColorMode(): ColorModeContextValue {
  const context = useContext(ColorModeContext);
  if (!context) throw new Error('useColorMode debe usarse dentro de un ColorModeProvider.');
  return context;
}

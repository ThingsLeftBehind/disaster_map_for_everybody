import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_STORAGE_KEY = 'hinanavi_theme_v1';

export type ThemeName = 'light' | 'dark';

export type ThemeColors = {
  background: string;
  surface: string;
  surfaceStrong: string;
  text: string;
  muted: string;
  border: string;
  card: string;
  overlay: string;
  statusOk: string;
  statusInfo: string;
  statusWarning: string;
  statusDanger: string;
  statusBgOk: string;
  statusBgInfo: string;
  statusBgWarning: string;
  statusBgDanger: string;
};

const lightColors: ThemeColors = {
  background: '#FFFFFF',
  surface: '#F7F7F7',
  surfaceStrong: '#EFEFEF',
  text: '#111111',
  muted: '#6B6B6B',
  border: '#E2E2E2',
  card: '#F6F6F6',
  overlay: 'rgba(0, 0, 0, 0.04)',
  statusOk: '#111111',
  statusInfo: '#1F2A44',
  statusWarning: '#8A5A00',
  statusDanger: '#8A1F1F',
  statusBgOk: '#111111',
  statusBgInfo: '#EEF1F7',
  statusBgWarning: '#FFF4E5',
  statusBgDanger: '#FDECEC',
};

const darkColors: ThemeColors = {
  background: '#000000',
  surface: '#111111',
  surfaceStrong: '#1A1A1A',
  text: '#FFFFFF',
  muted: '#A0A0A0',
  border: '#2A2A2A',
  card: '#111111',
  overlay: 'rgba(255, 255, 255, 0.04)',
  statusOk: '#FFFFFF',
  statusInfo: '#A7B0C4',
  statusWarning: '#D4A34A',
  statusDanger: '#D98C8C',
  statusBgOk: '#FFFFFF',
  statusBgInfo: '#1F2430',
  statusBgWarning: '#2A2416',
  statusBgDanger: '#2A1616',
};

type ThemeContextValue = {
  themeName: ThemeName;
  colors: ThemeColors;
  setThemeName: (name: ThemeName) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeName] = useState<ThemeName>('light');

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((stored) => {
        if (!active) return;
        if (stored === 'dark' || stored === 'light') {
          setThemeName(stored);
        }
      })
      .catch(() => {
        if (!active) return;
        setThemeName('light');
      });
    return () => {
      active = false;
    };
  }, []);

  const setTheme = useCallback((name: ThemeName) => {
    setThemeName(name);
    void AsyncStorage.setItem(THEME_STORAGE_KEY, name);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(themeName === 'dark' ? 'light' : 'dark');
  }, [setTheme, themeName]);

  const colors = themeName === 'dark' ? darkColors : lightColors;
  const value = useMemo(
    () => ({ themeName, colors, setThemeName: setTheme, toggleTheme }),
    [colors, setTheme, themeName, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return { themeName: 'light' as ThemeName, colors: lightColors, setThemeName: () => {}, toggleTheme: () => {} };
  }
  return ctx;
}

export function useThemedStyles<T>(factory: (colors: ThemeColors, themeName: ThemeName) => T): T {
  const { colors, themeName } = useTheme();
  return useMemo(() => factory(colors, themeName), [colors, themeName, factory]);
}

export const spacing = {
  xxs: 4,
  xs: 6,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
};

export const typography = {
  headline: {
    fontSize: 24,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  title: {
    fontSize: 22,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '600' as const,
  },
  body: {
    fontSize: 15,
    fontWeight: '400' as const,
  },
  label: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
  small: {
    fontSize: 13,
    fontWeight: '400' as const,
  },
  caption: {
    fontSize: 12,
    fontWeight: '400' as const,
  },
};

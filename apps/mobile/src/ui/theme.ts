export const colors = {
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

import { Platform, type TextStyle } from 'react-native';

/**
 * FieldOps mobile tokens.
 *
 * The palette is deliberately light-first: technicians work outdoors, and
 * dim-on-dim contrast is the first thing glare destroys. Semantic roles are
 * named by use, never by hue, so screens and components stay consistent.
 */
export { colors } from './palette';

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

export const radii = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  sheet: 24,
  pill: 999,
} as const;

export const touch = {
  minimum: 48,
  primary: 56,
  row: 64,
  option: 56,
} as const;

export const fontFamily = {
  system: Platform.select({ android: 'sans-serif', ios: 'System', default: 'system-ui' }),
  mono: Platform.select({ android: 'monospace', ios: 'Menlo', default: 'monospace' }),
} as const;

export const typography = {
  screenTitle: {
    fontFamily: fontFamily.system,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  title: {
    fontFamily: fontFamily.system,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
    letterSpacing: -0.25,
  },
  section: {
    fontFamily: fontFamily.system,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
  },
  body: {
    fontFamily: fontFamily.system,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
  },
  small: {
    fontFamily: fontFamily.system,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
  },
  label: {
    fontFamily: fontFamily.system,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  button: {
    fontFamily: fontFamily.system,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  identifier: {
    fontFamily: fontFamily.mono,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  timer: {
    fontFamily: fontFamily.system,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
} satisfies Record<string, TextStyle>;

export const elevation = {
  sheet: {
    shadowColor: '#11231f',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 12,
  },
} as const;

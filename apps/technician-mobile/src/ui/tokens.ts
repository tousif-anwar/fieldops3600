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
  massive: 48,
} as const;

export const radii = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 8,
  sheet: 12,
  pill: 999,
} as const;

export const touch = {
  minimum: 48,
  primary: 48,
  row: 64,
  option: 48,
} as const;

export const fontFamily = {
  system: Platform.select({ android: 'sans-serif', ios: 'System', default: 'system-ui' }),
  mono: Platform.select({ android: 'monospace', ios: 'Menlo', default: 'monospace' }),
} as const;

export const typography = {
  screenTitle: {
    fontFamily: fontFamily.system,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
  },
  title: {
    fontFamily: fontFamily.system,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
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
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  button: {
    fontFamily: fontFamily.system,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  caption: {
    fontFamily: fontFamily.system,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
  },
  strong: {
    fontFamily: fontFamily.system,
    fontSize: 16,
    lineHeight: 24,
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
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
} satisfies Record<string, TextStyle>;

export const borders = { thin: 1, focus: 2, accent: 3 } as const;

// Structural dimensions, not extra steps on the spacing or typography scales.
export const dimensions = {
  contentMax: 760,
  readableMax: 560,
  timeColumn: 72,
  stageMarker: 28,
  progress: 6,
  multiline: 112,
  compactMultiline: 96,
  fieldLabelMin: 120,
  sheetMaxHeight: '88%',
} as const;

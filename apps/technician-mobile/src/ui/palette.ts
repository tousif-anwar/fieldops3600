/**
 * Semantic color roles shared by the native design system.
 *
 * Kept free of React Native imports so contrast and pure UI tests can run under
 * Node without a native transform. The app still consumes these through tokens.
 */
export const colors = {
  ink: '#11231f',
  muted: '#465955',
  subtle: '#5b6b66',
  canvas: '#f2f5f1',
  surface: '#ffffff',
  surfaceMuted: '#e7eee9',
  border: '#d6e0da',
  borderStrong: '#7f9288',
  primary: '#0b5a49',
  primaryPressed: '#084536',
  primaryWash: '#e3f0ea',
  onPrimary: '#ffffff',
  success: '#1b6647',
  successWash: '#e4f1ea',
  warning: '#8a5a00',
  warningWash: '#fbf0d9',
  danger: '#a12b28',
  dangerWash: '#f9e7e3',
  info: '#075985',
  infoWash: '#e5f1f8',
  offline: '#596762',
  offlineWash: '#edf1ef',
  white: '#ffffff',
} as const;

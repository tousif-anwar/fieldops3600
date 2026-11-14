/**
 * Semantic color roles shared by the native design system.
 *
 * Kept free of React Native imports so contrast and pure UI tests can run under
 * Node without a native transform. The app still consumes these through tokens.
 */
export const colors = {
  ink: '#243447',
  muted: '#526174',
  subtle: '#617086',
  canvas: '#f4f6f8',
  surface: '#ffffff',
  surfaceMuted: '#edf1f5',
  border: '#dfe5ec',
  borderStrong: '#7c8ba0',
  primary: '#1f5aa6',
  primaryPressed: '#174680',
  primaryWash: '#eaf1fb',
  onPrimary: '#ffffff',
  success: '#247258',
  successWash: '#e9f4ee',
  warning: '#956013',
  warningWash: '#fff3dc',
  danger: '#b6403a',
  dangerPressed: '#932f2a',
  dangerWash: '#fbecea',
  info: '#1f5aa6',
  infoWash: '#eaf1fb',
  offline: '#526174',
  offlineWash: '#edf1f5',
  focus: '#1f5aa6',
  hover: '#edf2f8',
  disabled: '#66758a',
  disabledSurface: '#e8edf3',
  backdrop: 'rgba(36, 52, 71, 0.4)',
  white: '#ffffff',
} as const satisfies Record<string, string>;

export type ColorRole = keyof typeof colors;

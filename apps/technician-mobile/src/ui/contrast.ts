/** WCAG relative-luminance contrast, used to test the mobile palette. */
function channels(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) throw new Error(`Expected a six-digit hex color, received ${hex}`);
  return [0, 2, 4].map(index => parseInt(normalized.slice(index, index + 2), 16) / 255) as [number, number, number];
}

export function relativeLuminance(hex: string): number {
  const [red, green, blue] = channels(hex).map(channel =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

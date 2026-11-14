/**
 * Typed entry points for the web design system.
 *
 * CSS custom properties remain the runtime source of truth. This map gives
 * TypeScript consumers named, autocompleted roles instead of raw CSS strings.
 */
export const webTokens = {
  color: {
    canvas: "var(--color-canvas)",
    surface: "var(--color-surface)",
    surfaceMuted: "var(--color-surface-muted)",
    text: "var(--color-text)",
    muted: "var(--color-muted)",
    subtle: "var(--color-subtle)",
    disabled: "var(--color-disabled)",
    border: "var(--color-border)",
    borderStrong: "var(--color-border-strong)",
    hover: "var(--color-hover)",
    pressed: "var(--color-pressed)",
    primary: "var(--color-primary)",
    primaryHover: "var(--color-primary-hover)",
    primaryPressed: "var(--color-primary-pressed)",
    primarySurface: "var(--color-primary-surface)",
    onPrimary: "var(--color-on-primary)",
    focus: "var(--color-focus)",
    success: "var(--color-success)",
    successSurface: "var(--color-success-surface)",
    successBorder: "var(--color-success-border)",
    warning: "var(--color-warning)",
    warningSurface: "var(--color-warning-surface)",
    warningBorder: "var(--color-warning-border)",
    danger: "var(--color-danger)",
    dangerSurface: "var(--color-danger-surface)",
    dangerBorder: "var(--color-danger-border)",
    overlay: "var(--color-overlay)",
  },
  chart: {
    one: "var(--chart-1)",
    two: "var(--chart-2)",
    three: "var(--chart-3)",
    four: "var(--chart-4)",
    five: "var(--chart-5)",
  },
  space: {
    one: "var(--space-1)",
    two: "var(--space-2)",
    four: "var(--space-4)",
    eight: "var(--space-8)",
    twelve: "var(--space-12)",
    sixteen: "var(--space-16)",
    twenty: "var(--space-20)",
    twentyFour: "var(--space-24)",
    thirtyTwo: "var(--space-32)",
    forty: "var(--space-40)",
    fortyEight: "var(--space-48)",
    sixtyFour: "var(--space-64)",
  },
  radius: {
    sm: "var(--radius-sm)",
    md: "var(--radius-md)",
    lg: "var(--radius-lg)",
    pill: "var(--radius-pill)",
    round: "var(--radius-round)",
  },
  fontFamily: {
    sans: "var(--font-sans)",
    mono: "var(--font-mono)",
  },
  fontSize: {
    caption: "var(--font-size-12)",
    body: "var(--font-size-14)",
    bodyLarge: "var(--font-size-16)",
    section: "var(--font-size-18)",
    title: "var(--font-size-20)",
    display: "var(--font-size-24)",
    metric: "var(--font-size-28)",
  },
  fontWeight: {
    regular: "var(--font-weight-regular)",
    medium: "var(--font-weight-medium)",
    semibold: "var(--font-weight-semibold)",
  },
  lineHeight: {
    caption: "var(--line-height-16)",
    body: "var(--line-height-20)",
    bodyLarge: "var(--line-height-24)",
    section: "var(--line-height-28)",
    title: "var(--line-height-32)",
  },
} as const;

export type WebColorRole = keyof typeof webTokens.color;
export type WebChartRole = keyof typeof webTokens.chart;
export type WebSpaceRole = keyof typeof webTokens.space;
export type WebRadiusRole = keyof typeof webTokens.radius;

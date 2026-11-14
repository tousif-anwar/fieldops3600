import { StyleSheet } from 'react-native';
import { borders, colors, dimensions, radii, spacing, touch, typography } from './tokens';

export const textStyles = StyleSheet.create({
  body: { ...typography.body, color: colors.ink },
  bodySecondary: { ...typography.body, color: colors.muted },
  secondary: { ...typography.small, color: colors.muted },
  heading: { ...typography.section, color: colors.ink },
  title: { ...typography.title, color: colors.ink },
  label: { ...typography.label, color: colors.ink },
  link: {
    ...typography.label,
    color: colors.primary,
    minHeight: touch.minimum,
    paddingVertical: spacing.md,
  },
  warning: { ...typography.small, color: colors.warning },
});

export const listStyles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: dimensions.contentMax,
    alignSelf: 'center',
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  header: { gap: spacing.lg, paddingBottom: spacing.lg },
  row: {
    paddingVertical: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: borders.thin,
    borderBottomColor: colors.border,
  },
  section: {
    ...typography.section,
    color: colors.ink,
    backgroundColor: colors.canvas,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  footer: { paddingTop: spacing.lg, gap: spacing.md },
});

export const controlStyles = StyleSheet.create({
  input: {
    ...typography.body,
    color: colors.ink,
    backgroundColor: colors.surface,
    minHeight: touch.minimum,
    borderWidth: borders.thin,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    padding: spacing.md,
  },
  multiline: { minHeight: dimensions.multiline, textAlignVertical: 'top' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  modal: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.backdrop },
  sheet: {
    maxHeight: dimensions.sheetMaxHeight,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    borderCurve: 'continuous',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  sheetHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  sheetCopy: { flex: 1, gap: spacing.xs },
  option: {
    minHeight: touch.option,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.sm,
  },
  optionBorder: { borderBottomWidth: borders.thin, borderBottomColor: colors.border },
  selected: { backgroundColor: colors.primaryWash },
  pressed: { backgroundColor: colors.hover },
  disabled: { backgroundColor: colors.disabledSurface },
  focused: { borderColor: colors.focus },
});

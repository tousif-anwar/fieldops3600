import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, useRouter } from 'expo-router';
import { Children, type ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Booking, WorkOrder, WorkflowStage } from '../contracts';
import { useRuntime } from '../runtime';
import {
  borders, colors, dimensions, radii, spacing, touch, typography,
} from './tokens';
import {
  appointmentForJob, formatAppointment, formatStatus, jobStatusTone, priorityTone,
  slaPresentation, syncPresentation, type Tone,
} from './model';

export function Screen({
  children, footer, topInset = false, scrollable = true,
}: {
  children: ReactNode;
  footer?: ReactNode;
  topInset?: boolean;
  scrollable?: boolean;
}) {
  return (
    <SafeAreaView
      edges={topInset ? ['top', 'left', 'right', 'bottom'] : ['left', 'right', 'bottom']}
      style={styles.page}
    >
      {scrollable ? <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
      >
        <OfflineBanner />
        {children}
      </ScrollView> : <><OfflineBanner />{children}</>}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export function ScreenHeader({
  title, description, meta, action,
}: {
  title: string;
  description?: string;
  meta?: string;
  action?: ReactNode;
}) {
  const copy = <>
        {meta ? <Text style={styles.headerMeta}>{meta}</Text> : null}
        <Text accessibilityRole="header" style={styles.headerTitle}>{title}</Text>
        {description ? <Text style={styles.headerDescription}>{description}</Text> : null}
  </>;
  return <View style={action ? styles.headerRow : styles.header}>
    {action ? <View style={styles.headerCopy}>{copy}</View> : copy}{action}
  </View>;
}

export function Section({
  title, description, action, children, card = false, style,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  card?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.section, card && styles.card, style]}>
      {action ? (
        <View style={styles.sectionHeading}><View style={styles.sectionCopy}>
            {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
            {description ? <Text style={styles.small}>{description}</Text> : null}
        </View>{action}</View>
      ) : description ? <View style={styles.sectionCopy}>
        {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
        <Text style={styles.small}>{description}</Text>
      </View> : title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function Button({
  title, onPress, disabled = false, variant = 'primary', loading = false, hint, style,
}: {
  title: string;
  onPress(): void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  loading?: boolean;
  hint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const blocked = disabled || loading;
  const textColor = blocked ? colors.disabled : variant === 'primary' || variant === 'danger'
    ? colors.onPrimary
    : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={hint}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'quiet' && styles.buttonQuiet,
        variant === 'danger' && styles.buttonDanger,
        blocked && styles.disabled,
        pressed && !blocked && (variant === 'primary' ? styles.primaryPressed : variant === 'danger' ? styles.dangerPressed : styles.pressed),
        style,
      ]}
    >
      {loading
        ? <ActivityIndicator color={textColor} />
        : <Text style={[styles.buttonText, { color: textColor }]}>{title}</Text>}
    </Pressable>
  );
}

export function TextButton({
  title, onPress, disabled = false, danger = false, hint,
}: {
  title: string;
  onPress(): void;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.textButton, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <Text style={[styles.textButtonLabel, danger && styles.destructiveText, disabled && styles.disabledText]}>{title}</Text>
    </Pressable>
  );
}

export function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const palette = badgePalette[tone];
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[styles.status, { backgroundColor: palette.background }]}
    >
      <Text style={[styles.statusText, { color: palette.foreground }]}>{label}</Text>
    </View>
  );
}

const badgePalette: Record<Tone, { background: string; foreground: string }> = {
  success: { background: colors.successWash, foreground: colors.success },
  warning: { background: colors.warningWash, foreground: colors.warning },
  danger: { background: colors.dangerWash, foreground: colors.danger },
  info: { background: colors.infoWash, foreground: colors.info },
  neutral: { background: colors.surfaceMuted, foreground: colors.muted },
};

export function SyncBadge({ status }: { status: string }) {
  const presentation = syncPresentation(status);
  return <StatusBadge label={presentation.label} tone={presentation.tone} />;
}

export function InlineNotice({
  children, tone = 'info', title,
}: {
  children: ReactNode;
  tone?: 'success' | 'warning' | 'danger' | 'info';
  title?: string;
}) {
  const palette = noticePalette[tone];
  const content = Children.toArray(children);
  const textOnly = content.every(child => typeof child === 'string' || typeof child === 'number');
  return (
    <View
      accessibilityRole={tone === 'danger' || tone === 'warning' ? 'alert' : 'text'}
      accessibilityLiveRegion={tone === 'success' || tone === 'info' ? 'polite' : undefined}
      style={[styles.notice, { backgroundColor: palette.background, borderColor: palette.border }]}
    >
      {title ? <Text style={[styles.noticeTitle, { color: palette.foreground }]}>{title}</Text> : null}
      {textOnly
        ? <Text style={[styles.noticeText, { color: palette.foreground }]}>{children}</Text>
        : <View style={styles.noticeBody}>{content.map((child, index) =>
          typeof child === 'string' || typeof child === 'number'
            ? <Text key={index} style={[styles.noticeText, { color: palette.foreground }]}>{child}</Text>
            : child)}</View>}
    </View>
  );
}

const noticePalette = {
  success: { background: colors.successWash, border: colors.success, foreground: colors.success },
  warning: { background: colors.warningWash, border: colors.warning, foreground: colors.warning },
  danger: { background: colors.dangerWash, border: colors.danger, foreground: colors.danger },
  info: { background: colors.infoWash, border: colors.info, foreground: colors.info },
} as const;

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <View accessible accessibilityRole="progressbar" style={styles.loading}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.small}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  title, description, action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={[styles.small, styles.centerText]}>{description}</Text>
      {action}
    </View>
  );
}

export function ErrorState({
  error, retry,
}: {
  error: unknown;
  retry?(): void;
}) {
  const router = useRouter();
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : undefined;
  const sessionExpired = status === 401 || (error instanceof Error && /refresh token|authorization grant|token is not active|session expired/i.test(error.message));
  const title = status === 403 ? 'Access restricted'
    : sessionExpired ? 'Sign in again'
      : 'We couldn’t load this';
  const message = status === 403
    ? 'Your account does not have access to this job. Contact your supervisor if you need it.'
    : sessionExpired
      ? 'Your session expired. Sign out from Account, then sign in again. Your drafts remain on this device.'
      : error instanceof Error && error.message
        ? error.message
        : 'Check your connection and try again.';
  return (
    <View accessibilityRole="alert" style={styles.errorState}>
      <Text style={styles.errorTitle}>{title}</Text>
      <Text style={styles.errorText}>{message}</Text>
      {sessionExpired ? <Button title="Open Account" variant="secondary" onPress={() => router.push('/account')} />
        : retry ? <Button title="Try again" variant="secondary" onPress={retry} /> : null}
    </View>
  );
}

export function OfflineBanner() {
  const { online, submissions, queueError } = useRuntime();
  const pending = submissions.filter(item => item.status !== 'synced').length;
  if (online && !pending && !queueError) return null;
  const message = !online
    ? 'Offline. Work stays on this device; server deadlines continue.'
    : queueError
      ? 'Sync needs attention.'
      : `${pending} update${pending === 1 ? '' : 's'} waiting to sync.`;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.banner, !online && styles.bannerOffline]}
    >
      <Text style={styles.bannerText}>{message}</Text>
      <Link href="/sync" asChild>
        <Pressable accessibilityRole="link" accessibilityLabel="Review synchronization" style={styles.bannerAction}>
          <Text style={styles.bannerLink}>Review</Text>
        </Pressable>
      </Link>
    </View>
  );
}

export function JobListItem({
  job, booking, featured = false,
}: {
  job: WorkOrder;
  booking?: Booking;
  featured?: boolean;
}) {
  const appointment = booking ? formatAppointment(booking) : null;
  const priority = formatStatus(job.priority);
  const showPriority = job.priority === 'Critical' || job.priority === 'High';
  const rail = job.status === 'InProgress' ? colors.primary
    : job.priority === 'Critical' ? colors.danger
      : job.priority === 'High' ? colors.warning : colors.borderStrong;
  return (
    <Link
      href={{ pathname: '/job/[id]', params: { id: job.id } }}
      asChild
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${job.number}, ${job.title}, ${formatStatus(job.status)}${appointment ? `, ${appointment}` : ''}`}
        accessibilityHint="Opens job details"
        style={({ pressed }) => [
          styles.jobRow,
          featured && styles.jobFeatured,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.jobContent}>
          <View style={styles.jobTop}>
            <Text style={styles.jobNumber}>{job.number}</Text>
            <View style={styles.badgeRow}>
              <StatusBadge label={formatStatus(job.status)} tone={jobStatusTone(job.status)} />
              {showPriority ? <StatusBadge label={priority} tone={priorityTone(job.priority)} /> : null}
            </View>
          </View>
          <Text style={styles.jobTitle} numberOfLines={2}>{job.title}</Text>
          <Text style={styles.jobAddress} numberOfLines={2}>{job.siteAddress}</Text>
          <Text style={styles.jobMeta}>{job.serviceCategory}{appointment ? ` · ${appointment}` : ''}</Text>
        </View>
        <Ionicons name="chevron-forward" size={spacing.xl} color={rail} accessibilityElementsHidden importantForAccessibility="no" />
      </Pressable>
    </Link>
  );
}

export function StageProgress({
  stages, currentIndex,
}: {
  stages: Pick<WorkflowStage, 'id' | 'index' | 'status'>[];
  currentIndex: number;
}) {
  const completed = stages.filter(stage => ['Completed', 'Overridden'].includes(stage.status)).length;
  const finished = stages.length > 0 && completed === stages.length;
  return (
    <View
      accessible
      accessibilityLabel={`${completed} of ${stages.length} stages complete.${finished ? '' : ` Stage ${currentIndex + 1} is current.`}`}
      style={styles.progress}
    >
      <View style={styles.stageRailRow}>
        {stages.map(stage => (
          <View
            key={stage.id}
            style={[
              styles.segment,
              {
                backgroundColor: ['Completed', 'Overridden'].includes(stage.status)
                  ? colors.success
                  : stage.index === currentIndex ? colors.primary : colors.border,
              },
            ]}
          />
        ))}
      </View>
      <Text style={styles.small}>
        {completed} of {stages.length} stages complete{finished ? '' : ` · Stage ${currentIndex + 1}`}
      </Text>
    </View>
  );
}

export function SLAIndicator({
  stage, now, online,
}: {
  stage: WorkflowStage;
  now: number;
  online: boolean;
}) {
  const presentation = slaPresentation(stage, now, online);
  const color = presentation.tone === 'danger' ? colors.danger
    : presentation.tone === 'warning' ? colors.warning
      : presentation.tone === 'success' ? colors.success : colors.muted;
  return (
    <View
      accessible
      accessibilityLabel={`Stage deadline. ${presentation.label}. ${presentation.detail}`}
      style={[styles.sla, { borderLeftColor: color }]}
    >
        <Text style={styles.label}>Stage deadline</Text>
      <Text style={[styles.slaValue, { color }]}>{presentation.label}</Text>
      <Text style={styles.small}>{presentation.detail}</Text>
    </View>
  );
}

export function appointmentFor(job: WorkOrder, bookings: Booking[]): Booking | undefined {
  return appointmentForJob(bookings, job.id);
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  content: { width: '100%', maxWidth: dimensions.contentMax, alignSelf: 'center',
    padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.lg },
  footer: { borderTopWidth: borders.thin, borderTopColor: colors.border, backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm },
  header: { gap: spacing.xs, paddingBottom: spacing.xs },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headerCopy: { flex: 1, gap: spacing.xs },
  headerMeta: { ...typography.small, color: colors.subtle },
  headerTitle: { ...typography.screenTitle, color: colors.ink },
  headerDescription: { ...typography.small, color: colors.muted, maxWidth: dimensions.readableMax },
  section: { gap: spacing.md },
  card: { backgroundColor: colors.surface, borderWidth: borders.thin, borderColor: colors.border,
    borderRadius: radii.lg, borderCurve: 'continuous', padding: spacing.lg },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  sectionCopy: { flex: 1, gap: spacing.xs },
  sectionTitle: { ...typography.section, color: colors.ink },
  divider: { height: borders.thin, backgroundColor: colors.border, width: '100%' },
  button: { minHeight: touch.primary, borderRadius: radii.md, borderCurve: 'continuous',
    borderWidth: borders.thin, borderColor: 'transparent', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonSecondary: { backgroundColor: colors.surface, borderColor: colors.borderStrong },
  buttonQuiet: { backgroundColor: 'transparent' },
  buttonDanger: { backgroundColor: colors.danger },
  buttonText: { ...typography.button, textAlign: 'center', flexShrink: 1 },
  textButton: { minHeight: touch.minimum, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    justifyContent: 'center', alignItems: 'center', borderRadius: radii.sm, borderCurve: 'continuous' },
  textButtonLabel: { ...typography.button, color: colors.primary, textAlign: 'center' },
  destructiveText: { color: colors.danger },
  disabledText: { color: colors.disabled },
  disabled: { backgroundColor: colors.disabledSurface, borderColor: colors.border },
  pressed: { backgroundColor: colors.hover },
  primaryPressed: { backgroundColor: colors.primaryPressed },
  dangerPressed: { backgroundColor: colors.dangerPressed },
  status: { alignSelf: 'flex-start', borderRadius: radii.sm, borderCurve: 'continuous',
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  statusText: { ...typography.caption, fontWeight: typography.label.fontWeight },
  notice: { borderWidth: borders.thin, borderRadius: radii.md, borderCurve: 'continuous',
    padding: spacing.md, gap: spacing.xs },
  noticeTitle: { ...typography.label },
  noticeText: { ...typography.small },
  noticeBody: { gap: spacing.xs },
  loading: { minHeight: touch.minimum, flexDirection: 'row', alignItems: 'center',
    gap: spacing.sm, paddingVertical: spacing.md },
  empty: { gap: spacing.sm, paddingVertical: spacing.lg },
  centerText: { textAlign: 'left' },
  errorState: { gap: spacing.sm, padding: spacing.md, backgroundColor: colors.dangerWash,
    borderWidth: borders.thin, borderColor: colors.danger, borderRadius: radii.md, borderCurve: 'continuous' },
  errorTitle: { ...typography.label, color: colors.danger },
  errorText: { ...typography.small, color: colors.ink },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: borders.thin, borderColor: colors.warning, backgroundColor: colors.warningWash,
    borderRadius: radii.md, borderCurve: 'continuous', paddingHorizontal: spacing.md, minHeight: touch.minimum },
  bannerOffline: { borderColor: colors.offline, backgroundColor: colors.offlineWash },
  bannerText: { ...typography.small, color: colors.ink, flex: 1 },
  bannerAction: { minHeight: touch.minimum, justifyContent: 'center', paddingHorizontal: spacing.sm },
  bannerLink: { ...typography.label, color: colors.primary },
  jobRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md, borderBottomWidth: borders.thin, borderBottomColor: colors.border },
  jobFeatured: { backgroundColor: colors.primaryWash, borderRadius: radii.md, borderCurve: 'continuous' },
  jobContent: { flex: 1, gap: spacing.xs },
  jobTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  jobNumber: { ...typography.identifier, color: colors.primary, flexShrink: 1 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  jobTitle: { ...typography.strong, color: colors.ink },
  jobAddress: { ...typography.small, color: colors.muted },
  jobMeta: { ...typography.small, color: colors.subtle },
  progress: { gap: spacing.sm },
  stageRailRow: { flexDirection: 'row', gap: spacing.xs },
  segment: { flex: 1, height: dimensions.progress, borderRadius: radii.pill, borderCurve: 'continuous' },
  small: { ...typography.small, color: colors.muted },
  label: { ...typography.label, color: colors.subtle },
  sla: { borderLeftWidth: borders.accent, borderLeftColor: colors.borderStrong,
    backgroundColor: colors.surface, padding: spacing.md, gap: spacing.xs },
  slaValue: { ...typography.timer, flexShrink: 1 },
});

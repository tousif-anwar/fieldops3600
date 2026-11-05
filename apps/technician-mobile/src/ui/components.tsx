import { Link } from 'expo-router';
import { type ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Booking, WorkOrder, WorkflowStage } from '../contracts';
import { useRuntime } from '../runtime';
import {
  colors, radii, spacing, touch, typography,
} from './tokens';
import {
  appointmentForJob, formatAppointment, formatStatus, jobStatusTone, priorityTone,
  slaPresentation, syncPresentation, type Tone,
} from './model';

export function Screen({
  children, footer, topInset = false,
}: {
  children: ReactNode;
  footer?: ReactNode;
  topInset?: boolean;
}) {
  return (
    <SafeAreaView
      edges={topInset ? ['top', 'left', 'right', 'bottom'] : ['left', 'right', 'bottom']}
      style={styles.page}
    >
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
      >
        <OfflineBanner />
        {children}
      </ScrollView>
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
  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        {meta ? <Text style={styles.headerMeta}>{meta}</Text> : null}
        <Text accessibilityRole="header" style={styles.headerTitle}>{title}</Text>
        {description ? <Text style={styles.headerDescription}>{description}</Text> : null}
      </View>
      {action}
    </View>
  );
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
      {title || description || action ? (
        <View style={styles.sectionHeading}>
          <View style={styles.sectionCopy}>
            {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
            {description ? <Text style={styles.small}>{description}</Text> : null}
          </View>
          {action}
        </View>
      ) : null}
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
  const textColor = variant === 'primary' || variant === 'danger'
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
        pressed && !blocked && styles.pressed,
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
      <Text style={[styles.textButtonLabel, danger && { color: colors.danger }]}>{title}</Text>
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
      <View style={[styles.statusDot, { backgroundColor: palette.foreground }]} />
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
  return (
    <View
      accessibilityRole={tone === 'danger' || tone === 'warning' ? 'alert' : 'text'}
      accessibilityLiveRegion={tone === 'success' || tone === 'info' ? 'polite' : undefined}
      style={[styles.notice, { backgroundColor: palette.background, borderColor: palette.border }]}
    >
      {title ? <Text style={[styles.noticeTitle, { color: palette.foreground }]}>{title}</Text> : null}
      {typeof children === 'string' || typeof children === 'number'
        ? <Text style={[styles.noticeText, { color: palette.foreground }]}>{children}</Text>
        : <View style={styles.noticeBody}>{children}</View>}
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
      <View style={styles.emptyMark}><Text style={styles.emptyMarkText}>—</Text></View>
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
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : undefined;
  const title = status === 403 ? 'Access is restricted'
    : status === 401 ? 'Your session needs attention'
      : 'We couldn’t load this';
  const message = status === 403
    ? 'Your account does not have access to this job. Contact your supervisor if you need it.'
    : status === 401
      ? 'Sign in again to restore this view. Your local drafts remain on this device.'
      : error instanceof Error && error.message
        ? error.message
        : 'Check your connection and try again.';
  return (
    <View accessibilityRole="alert" style={styles.errorState}>
      <Text style={styles.errorTitle}>{title}</Text>
      <Text style={styles.errorText}>{message}</Text>
      {retry ? <Button title="Try again" variant="secondary" onPress={retry} /> : null}
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
      <View style={[styles.bannerDot, { backgroundColor: online ? colors.warning : colors.offline }]} />
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
        <View style={[styles.jobRail, { backgroundColor: rail }]} />
        <View style={styles.jobContent}>
          {featured ? <Text style={styles.featuredLabel}>Current job</Text> : null}
          <View style={styles.jobTop}>
            <Text style={styles.jobNumber}>{job.number}</Text>
            <View style={styles.badgeRow}>
              <StatusBadge label={formatStatus(job.status)} tone={jobStatusTone(job.status)} />
              {showPriority ? <StatusBadge label={priority} tone={priorityTone(job.priority)} /> : null}
            </View>
          </View>
          <Text style={styles.jobTitle} numberOfLines={2}>{job.title}</Text>
          <Text style={styles.jobAddress} numberOfLines={2}>{job.siteAddress}</Text>
          <View style={styles.jobMetaRow}>
            <Text style={styles.jobMeta}>{job.serviceCategory}</Text>
            {appointment ? <Text style={styles.jobMeta}>· {appointment}</Text> : null}
          </View>
          <View style={styles.jobFooter}>
            <Text style={styles.linkText}>{job.status === 'InProgress' ? 'Continue job' : 'Open job'}</Text>
            <Text style={styles.chevron}>›</Text>
          </View>
        </View>
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
  return (
    <View
      accessible
      accessibilityLabel={`${completed} of ${stages.length} stages complete. Stage ${currentIndex + 1} is current.`}
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
        {completed} of {stages.length} stages complete · Stage {currentIndex + 1}
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
      <View style={styles.slaHeading}>
        <Text style={styles.label}>Stage deadline</Text>
        <View style={[styles.slaDot, { backgroundColor: color }]} />
      </View>
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
  content: {
    width: '100%', maxWidth: 760, alignSelf: 'center',
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  footer: {
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: spacing.md, paddingBottom: spacing.xs,
  },
  headerCopy: { flex: 1, gap: spacing.xs },
  headerMeta: { ...typography.label, color: colors.subtle },
  headerTitle: { ...typography.screenTitle, color: colors.ink },
  headerDescription: { ...typography.body, color: colors.muted, maxWidth: 560 },
  section: { gap: spacing.md },
  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.lg, padding: spacing.lg,
  },
  sectionHeading: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: spacing.md,
  },
  sectionCopy: { flex: 1, gap: spacing.xs },
  sectionTitle: { ...typography.section, color: colors.ink },
  divider: { height: 1, backgroundColor: colors.border, width: '100%' },
  button: {
    minHeight: touch.primary, borderRadius: radii.md, borderWidth: 1,
    borderColor: 'transparent', paddingHorizontal: spacing.lg,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch',
  },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonSecondary: { backgroundColor: colors.surface, borderColor: colors.primary },
  buttonQuiet: { backgroundColor: 'transparent' },
  buttonDanger: { backgroundColor: colors.danger },
  buttonText: { ...typography.button },
  textButton: {
    minHeight: touch.minimum, paddingHorizontal: spacing.xs,
    justifyContent: 'center', alignItems: 'center',
  },
  textButtonLabel: { ...typography.button, color: colors.primary },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.76 },
  status: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: radii.sm, paddingHorizontal: spacing.sm, paddingVertical: 5,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { ...typography.label, fontSize: 12, lineHeight: 16 },
  notice: {
    borderWidth: 1, borderRadius: radii.md, padding: spacing.md,
    gap: spacing.xs,
  },
  noticeTitle: { ...typography.label },
  noticeText: { ...typography.small },
  noticeBody: { gap: spacing.xs },
  loading: {
    minHeight: 88, alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg,
  },
  empty: {
    alignItems: 'center', gap: spacing.sm, padding: spacing.xxl,
    backgroundColor: colors.surface, borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  emptyMark: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center',
    justifyContent: 'center', backgroundColor: colors.surfaceMuted,
  },
  emptyMarkText: { ...typography.title, color: colors.muted },
  centerText: { textAlign: 'center' },
  errorState: {
    gap: spacing.sm, padding: spacing.lg, backgroundColor: colors.dangerWash,
    borderWidth: 1, borderColor: colors.danger, borderRadius: radii.lg,
  },
  errorTitle: { ...typography.section, color: colors.danger },
  errorText: { ...typography.small, color: colors.ink },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningWash,
    borderRadius: radii.md, paddingHorizontal: spacing.md, minHeight: touch.minimum,
  },
  bannerOffline: { borderColor: colors.offline, backgroundColor: colors.offlineWash },
  bannerDot: { width: 8, height: 8, borderRadius: 4 },
  bannerText: { ...typography.small, color: colors.ink, flex: 1 },
  bannerAction: { minHeight: touch.minimum, justifyContent: 'center', paddingLeft: spacing.sm },
  bannerLink: { ...typography.label, color: colors.primary },
  jobRow: {
    flexDirection: 'row', overflow: 'hidden', backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg,
    minHeight: 164,
  },
  jobFeatured: { borderColor: colors.primary, backgroundColor: colors.primaryWash },
  jobRail: { width: 4 },
  jobContent: { flex: 1, padding: spacing.lg, gap: 6 },
  featuredLabel: { ...typography.label, color: colors.primary },
  jobTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  jobNumber: { ...typography.identifier, color: colors.primary, flexShrink: 1 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 },
  jobTitle: { ...typography.title, fontSize: 18, lineHeight: 23, color: colors.ink },
  jobAddress: { ...typography.small, color: colors.muted },
  jobMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  jobMeta: { ...typography.label, color: colors.subtle, fontWeight: '400' },
  jobFooter: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 'auto' },
  linkText: { ...typography.label, color: colors.primary },
  chevron: { ...typography.title, color: colors.primary, lineHeight: 20 },
  progress: { gap: spacing.sm },
  stageRailRow: { flexDirection: 'row', gap: spacing.xs },
  segment: { flex: 1, height: 6, borderRadius: 3 },
  small: { ...typography.small, color: colors.muted },
  label: { ...typography.label, color: colors.subtle },
  sla: {
    borderWidth: 1, borderLeftWidth: 4, borderColor: colors.border,
    borderRadius: radii.md, backgroundColor: colors.surface,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: 4,
  },
  slaHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  slaDot: { width: 8, height: 8, borderRadius: 4 },
  slaValue: { ...typography.timer },
});

import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../src/auth';
import { useRuntime } from '../../src/runtime';
import { completedVisitsToday, serviceActivity } from '../../src/itinerary';
import { useActivity } from '../../src/use-activity';
import { useWorkOrders } from '../../src/use-work-orders';
import {
  Button, InlineNotice, LoadingState, Screen, ScreenHeader, Section, StatusBadge,
} from '../../src/ui';
import { formatTimestamp } from '../../src/ui/model';
import { colors, spacing, typography } from '../../src/ui/tokens';

export default function Account() {
  const { session, logout, error } = useAuth();
  const { online, submissions } = useRuntime();
  const activity = useActivity();
  const work = useWorkOrders();
  const recent = serviceActivity(activity.data ?? []).slice(0, 8);
  const pending = submissions.filter(item => item.status !== 'synced').length;
  return (
    <Screen topInset>
      <ScreenHeader
        title="Account"
        description="Your secure technician session and local work state."
      />
      <Section card title={session?.displayName ?? 'Technician'} description="Signed in to FieldOps 360">
        <View style={styles.statusRow}>
          <StatusBadge label={online ? 'Online' : 'Offline'} tone={online ? 'success' : 'warning'} />
          <StatusBadge
            label={pending ? `${pending} waiting to sync` : 'All work synced'}
            tone={pending ? 'warning' : 'success'}
          />
        </View>
        <Text style={styles.small}>
          Your access token is stored in this device’s secure storage. Drafts and queued
          submissions remain available without a connection.
        </Text>
        <Link href="/sync" style={styles.link}>Review synchronization</Link>
      </Section>
      <Section card title="Your service activity" description="Recorded workflow milestones from your authorized work.">
        {activity.isPending && !activity.data ? <LoadingState label="Loading service activity…" /> : null}
        {activity.error ? <InlineNotice tone="warning" title="Activity needs refreshing">{activity.data ? 'Showing the last synchronized service history.' : 'Connect to load recorded service activity.'}</InlineNotice> : null}
        {activity.data ? <Text style={styles.body}>{completedVisitsToday(activity.data)} visits completed today · {activity.data.filter(item => item.status === 'Completed').length} completed in your loaded history.</Text> : null}
        {activity.data && !recent.length ? <Text style={styles.small}>Completed service stages will appear here after the server accepts your work.</Text> : null}
        {recent.map(event => (
          <View key={event.id} style={styles.activity}>
            <Text style={styles.body}>{event.label}</Text>
            <Text style={styles.small}>{formatTimestamp(event.occurredAtUtc)}</Text>
            <Link href={{ pathname: '/job/[id]', params: { id: event.workOrderId } }} style={styles.link}>
              {work.data?.find(item => item.id === event.workOrderId)?.number ?? 'View job history'}
            </Link>
          </View>
        ))}
        <Text style={styles.small}>History is limited to the latest 500 authorized workflows. These milestones describe recorded service activity.</Text>
      </Section>
      <Section title="Device storage" description="What stays on this phone">
        <Text style={styles.body}>
          Draft answers are kept on this device so an interrupted job can be resumed.
          A queued submission is not an accepted stage until the server confirms it.
        </Text>
        <Text style={styles.small}>
          This development build uses OS-protected storage for the session, not full
          application-level encryption of draft data. Sign out on a shared device.
        </Text>
      </Section>
      {error ? <InlineNotice tone="danger" title="Secure session notice">{error}</InlineNotice> : null}
      <Button
        title="Sign out"
        variant="secondary"
        onPress={() => { void logout(); }}
        hint="Clears this device’s session and opens the identity provider sign-out page"
      />
      <Text style={styles.footer}>FieldOps 360 · Technician workspace</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  activity: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: spacing.xs },
  body: { ...typography.body, color: colors.ink },
  small: { ...typography.small, color: colors.muted },
  link: { ...typography.label, color: colors.primary, paddingVertical: spacing.sm },
  footer: { ...typography.small, color: colors.subtle, textAlign: 'center', marginTop: spacing.sm },
});

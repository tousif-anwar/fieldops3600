import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../src/auth';
import { useRuntime } from '../../src/runtime';
import { completedVisitsToday, serviceActivity } from '../../src/itinerary';
import { useActivity } from '../../src/use-activity';
import { useWorkOrders } from '../../src/use-work-orders';
import {
  Button,
  InlineNotice,
  LoadingState,
  Screen,
  ScreenHeader,
  Section,
  StatusBadge,
  textStyles,
} from '../../src/ui';
import { formatTimestamp } from '../../src/ui/model';
import { colors, spacing } from '../../src/ui/tokens';

export default function Account() {
  const { session, logout, error } = useAuth();
  const { online, submissions } = useRuntime();
  const activity = useActivity();
  const work = useWorkOrders();
  const recent = serviceActivity(activity.data ?? []).slice(0, 8);
  const pending = submissions.filter((item) => item.status !== 'synced').length;
  return (
    <Screen topInset>
      <ScreenHeader title="Account" />
      <Section title={session?.displayName ?? 'Technician'}>
        <View style={styles.statusRow}>
          <StatusBadge
            label={online ? 'Online' : 'Offline'}
            tone={online ? 'success' : 'warning'}
          />
          <StatusBadge
            label={pending ? `${pending} waiting to sync` : 'All work synced'}
            tone={pending ? 'warning' : 'success'}
          />
        </View>
        <Text style={textStyles.secondary}>
          Your access token is stored in this device’s secure storage. Drafts and queued submissions
          remain available without a connection.
        </Text>
        <Link href="/sync" style={textStyles.link}>
          Review synchronization
        </Link>
      </Section>
      <Section title="Service activity">
        {activity.isPending && !activity.data ? (
          <LoadingState label="Loading service activity…" />
        ) : null}
        {activity.error ? (
          <InlineNotice tone="warning" title="Activity needs refreshing">
            {activity.data
              ? 'Showing the last synchronized service history.'
              : 'Connect to load recorded service activity.'}
          </InlineNotice>
        ) : null}
        {activity.data ? (
          <Text style={textStyles.body}>
            {completedVisitsToday(activity.data)} visits completed today ·{' '}
            {activity.data.filter((item) => item.status === 'Completed').length} completed in your
            loaded history.
          </Text>
        ) : null}
        {activity.data && !recent.length ? (
          <Text style={textStyles.secondary}>No completed service stages yet.</Text>
        ) : null}
        {recent.map((event) => (
          <View key={event.id} style={styles.activity}>
            <Text style={textStyles.body}>{event.label}</Text>
            <Text style={textStyles.secondary}>{formatTimestamp(event.occurredAtUtc)}</Text>
            <Link
              href={{ pathname: '/job/[id]', params: { id: event.workOrderId } }}
              style={textStyles.link}
            >
              {work.data?.find((item) => item.id === event.workOrderId)?.number ??
                'View job history'}
            </Link>
          </View>
        ))}
        <Text style={textStyles.secondary}>Latest 500 authorized workflows.</Text>
      </Section>
      <Section title="Device storage">
        <Text style={textStyles.body}>
          Drafts remain on this device. Queued responses require server acceptance.
        </Text>
        <Text style={textStyles.secondary}>
          Draft data has no application-level encryption. Sign out on shared devices.
        </Text>
      </Section>
      {error ? (
        <InlineNotice tone="danger" title="Secure session notice">
          {error}
        </InlineNotice>
      ) : null}
      <Button
        title="Sign out"
        variant="secondary"
        onPress={() => {
          void logout();
        }}
        hint="Clears this device’s session and opens the identity provider sign-out page"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  activity: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
});

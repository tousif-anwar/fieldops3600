import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { dailyItinerary, nextStop, scheduledMinutes } from '../../src/itinerary';
import { useRuntime } from '../../src/runtime';
import { useActivity } from '../../src/use-activity';
import { useBookings } from '../../src/use-bookings';
import { useWorkOrders } from '../../src/use-work-orders';
import {
  Button,
  EmptyState,
  ErrorState,
  InlineNotice,
  LoadingState,
  Screen,
  ScreenHeader,
  StatusBadge,
  TextButton,
  listStyles,
  textStyles,
} from '../../src/ui';
import { DirectionsButton } from '../../src/ui/directions';
import { formatTime, priorityTone } from '../../src/ui/model';
import { colors, dimensions, spacing, typography } from '../../src/ui/tokens';

export default function Schedule() {
  const query = useBookings();
  const work = useWorkOrders();
  const activity = useActivity();
  const { online } = useRuntime();
  const router = useRouter();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const stops = dailyItinerary(
    query.data ?? [],
    work.data ?? [],
    activity.data ?? [],
    new Date(now),
  );
  const next = nextStop(stops);
  const completed = stops.filter((stop) => stop.completed).length;
  const date = new Date(now).toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const header = (
    <View style={listStyles.header}>
      <ScreenHeader
        title="Daily itinerary"
        meta={date}
        description="Device-local appointment times"
        action={
          <TextButton
            title="Refresh"
            disabled={!online || query.isFetching}
            onPress={() => {
              void Promise.all([query.refetch(), work.refetch(), activity.refetch()]);
            }}
          />
        }
      />
      <Text style={textStyles.body}>
        {completed} of {stops.length} stops complete · {scheduledMinutes(stops)} minutes booked
      </Text>
      {next?.job ? (
        <Button
          title={next.inProgress ? 'Continue current stop' : 'Review next stop'}
          onPress={() =>
            router.push({ pathname: '/job/[id]', params: { id: next.booking.workOrderId } })
          }
        />
      ) : null}
      {query.dataUpdatedAt ? (
        <Text style={textStyles.secondary}>
          Last sync {formatTime(new Date(query.dataUpdatedAt).toISOString())}
          {online ? '' : ' · cached'}
        </Text>
      ) : null}
      {query.isPending && !query.data ? <LoadingState label="Loading appointments…" /> : null}
      {query.error && !query.data ? (
        <ErrorState
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : null}
      {query.error && query.data ? (
        <InlineNotice tone="warning" title="Showing cached appointments">
          Confirm changes with dispatch before travelling.
        </InlineNotice>
      ) : null}
      {work.error ? (
        <InlineNotice tone="warning" title="Site details unavailable">
          Reconnect to load the current destination.
        </InlineNotice>
      ) : null}
      {query.data && stops.length === 0 ? (
        <EmptyState
          title="No appointments today"
          description="Assigned work is available on Home."
        />
      ) : null}
    </View>
  );
  return (
    <Screen topInset scrollable={false}>
      <FlatList
        data={stops}
        contentContainerStyle={listStyles.content}
        ListHeaderComponent={header}
        keyExtractor={(stop) => stop.booking.id}
        renderItem={({ item: stop }) => (
          <View style={[listStyles.row, styles.row]}>
            <View style={styles.timeColumn}>
              <Text style={styles.time}>{formatTime(stop.booking.startUtc)}</Text>
              <Text style={textStyles.secondary}>{formatTime(stop.booking.endUtc)}</Text>
            </View>
            <View style={styles.details}>
              <View style={styles.badgeRow}>
                <StatusBadge
                  label={
                    stop.completed
                      ? 'Completed'
                      : stop.inProgress
                        ? 'In progress'
                        : next === stop
                          ? 'Next stop'
                          : 'Confirmed'
                  }
                  tone={stop.completed ? 'success' : stop.inProgress ? 'info' : 'neutral'}
                />
                {stop.job ? (
                  <StatusBadge label={stop.job.priority} tone={priorityTone(stop.job.priority)} />
                ) : null}
              </View>
              <Text style={styles.title}>
                {stop.job ? `${stop.job.number} · ${stop.job.title}` : 'Assigned service visit'}
              </Text>
              {stop.job ? (
                <>
                  <Text style={textStyles.body}>{stop.job.customerName}</Text>
                  <Text selectable style={textStyles.secondary}>
                    {stop.job.siteAddress}
                  </Text>
                </>
              ) : null}
              {stop.windowPassed ? (
                <Text accessibilityRole="alert" style={styles.warning}>
                  Appointment window passed. Contact dispatch.
                </Text>
              ) : null}
              <Button
                title={stop.completed ? 'View service history' : 'Open job'}
                variant="quiet"
                onPress={() =>
                  router.push({ pathname: '/job/[id]', params: { id: stop.booking.workOrderId } })
                }
              />
              {!stop.completed && stop.job ? (
                <DirectionsButton address={stop.job.siteAddress} />
              ) : null}
            </View>
          </View>
        )}
      />
    </Screen>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  timeColumn: { width: dimensions.timeColumn, gap: spacing.xs },
  time: { ...typography.strong, color: colors.ink, fontVariant: ['tabular-nums'] },
  details: { flex: 1, gap: spacing.xs },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  title: { ...typography.strong, color: colors.ink },
  warning: { ...typography.small, color: colors.warning },
});

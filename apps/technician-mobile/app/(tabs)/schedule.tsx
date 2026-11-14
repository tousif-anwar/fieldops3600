import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { dailyItinerary, nextStop, scheduledMinutes } from '../../src/itinerary';
import { useRuntime } from '../../src/runtime';
import { useActivity } from '../../src/use-activity';
import { useBookings } from '../../src/use-bookings';
import { useWorkOrders } from '../../src/use-work-orders';
import {
  Button, EmptyState, ErrorState, InlineNotice, LoadingState, Screen, ScreenHeader, Section, StatusBadge,
} from '../../src/ui';
import { DirectionsButton } from '../../src/ui/directions';
import { formatTime, priorityTone } from '../../src/ui/model';
import { colors, spacing, typography } from '../../src/ui/tokens';

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
  const stops = dailyItinerary(query.data ?? [], work.data ?? [], activity.data ?? [], new Date(now));
  const next = nextStop(stops);
  const completed = stops.filter(stop => stop.completed).length;
  const date = new Date(now).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <Screen topInset>
      <ScreenHeader title="Daily itinerary" meta={date} description="Confirmed stops in appointment order. Times use this device’s time zone." />
      <Section card title={`${completed} of ${stops.length} stops complete`}>
        <Text style={styles.body}>{scheduledMinutes(stops)} minutes booked today. Confirmed windows remain set by dispatch.</Text>
        {next?.job ? <Button title={next.inProgress ? 'Continue current stop' : 'Review next stop'}
          onPress={() => router.push({ pathname: '/job/[id]', params: { id: next.booking.workOrderId } })} /> : null}
        {query.dataUpdatedAt ? <Text style={styles.small}>Last schedule sync {formatTime(new Date(query.dataUpdatedAt).toISOString())}{online ? '' : ' · cached on this device'}</Text> : null}
        <Button title="Refresh itinerary" variant="quiet" disabled={!online || query.isFetching}
          onPress={() => { void Promise.all([query.refetch(), work.refetch(), activity.refetch()]); }} />
      </Section>
      {query.isPending && !query.data ? <LoadingState label="Loading today’s appointments…" /> : null}
      {query.error && !query.data ? (
        <ErrorState error={query.error} retry={() => { void query.refetch(); }} />
      ) : null}
      {query.error && query.data ? <InlineNotice tone="warning" title="Showing cached appointments">The schedule could not be refreshed. Contact dispatch before travelling if the appointment may have changed.</InlineNotice> : null}
      {work.error ? <InlineNotice tone="warning" title="Site details unavailable">Appointment windows remain visible. Refresh when connected to load the current job and destination.</InlineNotice> : null}
      {query.data && stops.length === 0 ? (
        <EmptyState
          title="No appointments today"
          description="Your next confirmed appointments will appear here. Assigned work is available on Home."
        />
      ) : null}
      {stops.length ? (
        <Section title="Today’s stops" description="Open the job to record travel, arrival, or service progress.">
          <View style={styles.list}>
            {stops.map((stop, index) => (
              <View key={stop.booking.id}>
                <View style={styles.row}>
                  <View style={styles.timeColumn}>
                    <Text style={styles.time}>{formatTime(stop.booking.startUtc)}</Text>
                    <Text style={styles.small}>{formatTime(stop.booking.endUtc)}</Text>
                  </View>
                  <View style={styles.rule} />
                  <View style={styles.details}>
                    <View style={styles.badgeRow}>
                      <StatusBadge label={stop.completed ? 'Completed' : stop.inProgress ? 'In progress' : next === stop ? 'Next stop' : 'Confirmed'}
                        tone={stop.completed ? 'success' : stop.inProgress ? 'info' : 'neutral'} />
                      {stop.job ? <StatusBadge label={stop.job.priority} tone={priorityTone(stop.job.priority)} /> : null}
                    </View>
                    <Text style={styles.title}>{stop.job ? `${stop.job.number} · ${stop.job.title}` : 'Assigned service visit'}</Text>
                    {stop.job ? <Text style={styles.body}>{stop.job.customerName}</Text> : null}
                    {stop.job ? <Text selectable style={styles.small}>{stop.job.siteAddress}</Text> : null}
                    {stop.windowPassed ? <Text accessibilityRole="alert" style={styles.warning}>Appointment window passed. Contact dispatch about the delay.</Text> : null}
                    <Button title={stop.completed ? 'View service history' : 'Open job'} variant="quiet"
                      onPress={() => router.push({ pathname: '/job/[id]', params: { id: stop.booking.workOrderId } })} />
                    {!stop.completed && stop.job ? <DirectionsButton address={stop.job.siteAddress} /> : null}
                  </View>
                </View>
                {index < stops.length - 1 ? <View style={styles.divider} /> : null}
              </View>
            ))}
          </View>
        </Section>
      ) : null}
      <Text style={styles.small}>Directions open Google Maps in its app or browser. If maps are unavailable, the service address remains selectable here. Travel estimates are provided by your navigation app.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: 0 },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing.md, gap: spacing.md },
  timeColumn: { width: 76, gap: 2 },
  time: { ...typography.section, color: colors.ink, fontVariant: ['tabular-nums'] },
  rule: { width: 3, alignSelf: 'stretch', backgroundColor: colors.primary, borderRadius: 2 },
  details: { flex: 1, gap: 4 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  title: { ...typography.section, color: colors.ink },
  body: { ...typography.body, color: colors.ink },
  warning: { ...typography.small, color: colors.warning },
  small: { ...typography.small, color: colors.muted },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: 88 },
});

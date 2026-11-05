import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useBookings } from '../../src/use-bookings';
import {
  EmptyState, ErrorState, LoadingState, Screen, ScreenHeader, Section, StatusBadge,
} from '../../src/ui';
import { formatStatus, formatTime, statusTone } from '../../src/ui/model';
import { colors, spacing, typography } from '../../src/ui/tokens';

export default function Schedule() {
  const query = useBookings();
  const today = new Date().toDateString();
  const bookings = (query.data ?? [])
    .filter(booking => new Date(booking.startUtc).toDateString() === today && booking.status !== 'Cancelled')
    .sort((left, right) => left.startUtc.localeCompare(right.startUtc));
  const date = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <Screen topInset>
      <ScreenHeader title="Schedule" meta={date} description="Your assigned appointments in device-local time." />
      {query.isPending && !query.data ? <LoadingState label="Loading today’s appointments…" /> : null}
      {query.error && !query.data ? (
        <ErrorState error={query.error} retry={() => { void query.refetch(); }} />
      ) : null}
      {query.data && bookings.length === 0 ? (
        <EmptyState
          title="No appointments today"
          description="Your next scheduled work will appear here. You can still open assigned jobs from the Jobs tab."
        />
      ) : null}
      {bookings.length ? (
        <Section title="Today’s appointments" description="The next arrival is listed first.">
          <View style={styles.list}>
            {bookings.map((booking, index) => (
              <View key={booking.id}>
                <View style={styles.row}>
                  <View style={styles.timeColumn}>
                    <Text style={styles.time}>{formatTime(booking.startUtc)}</Text>
                    <Text style={styles.small}>{formatTime(booking.endUtc)}</Text>
                  </View>
                  <View style={styles.rule} />
                  <View style={styles.details}>
                    <View style={styles.badgeRow}>
                      <StatusBadge label={formatStatus(booking.status)} tone={statusTone(booking.status)} />
                    </View>
                    <Text style={styles.title}>Assigned service visit</Text>
                    <Link
                      href={{ pathname: '/job/[id]', params: { id: booking.workOrderId } }}
                      style={styles.link}
                    >
                      Open job and site details
                    </Link>
                  </View>
                </View>
                {index < bookings.length - 1 ? <View style={styles.divider} /> : null}
              </View>
            ))}
          </View>
        </Section>
      ) : null}
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
  badgeRow: { flexDirection: 'row' },
  title: { ...typography.section, color: colors.ink },
  link: { ...typography.label, color: colors.primary, paddingVertical: spacing.sm },
  small: { ...typography.small, color: colors.muted },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: 88 },
});

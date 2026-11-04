import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import { requestApi } from '../src/api';
import { useAuth } from '../src/auth';
import type { Booking } from '../src/contracts';
import { Badge, ErrorMessage, Loading, Screen, styles } from '../src/ui';

export default function Schedule() {
  const { getAccessToken } = useAuth();
  const query = useQuery({ queryKey: ['bookings'], queryFn: async () =>
    (await requestApi<Booking[]>('/api/bookings', await getAccessToken())).data });
  const today = new Date().toDateString();
  const bookings = (query.data ?? []).filter(booking => new Date(booking.startUtc).toDateString() === today
    && booking.status !== 'Cancelled').sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  return <Screen>
    <Text accessibilityRole="header" style={styles.title}>Today’s schedule</Text>
    <Text style={styles.muted}>Times are displayed in your device’s local timezone.</Text>
    {query.isPending && <Loading />}
    {query.error && <ErrorMessage error={query.error} retry={() => { void query.refetch(); }} />}
    {query.data && !bookings.length && <View style={styles.card}><Text style={styles.body}>No appointments scheduled today.</Text></View>}
    {bookings.map(booking => <View style={styles.card} key={booking.id}>
      <View style={styles.row}><Text style={styles.subtitle}>{new Date(booking.startUtc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        {' – '}{new Date(booking.endUtc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text><Badge>{booking.status}</Badge></View>
      <Link href={{ pathname: '/job/[id]', params: { id: booking.workOrderId } }} style={styles.secondaryText}>Open assigned job →</Link>
    </View>)}
  </Screen>;
}

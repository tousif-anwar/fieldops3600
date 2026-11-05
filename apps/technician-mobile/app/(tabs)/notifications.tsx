import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import { requestApi } from '../src/api';
import { useAuth } from '../src/auth';
import type { Notification } from '../src/contracts';
import { useRuntime } from '../src/runtime';
import { Badge, Button, ErrorMessage, Loading, Screen, styles } from '../src/ui';

export default function Notifications() {
  const { getAccessToken } = useAuth();
  const { online } = useRuntime();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['notifications'], meta: { persist: false },
    refetchInterval: online ? 15_000 : false, queryFn: async () =>
      (await requestApi<Notification[]>('/api/notifications', await getAccessToken())).data });
  const acknowledge = useMutation({ mutationFn: async (id: string) =>
    requestApi(`/api/notifications/${encodeURIComponent(id)}/acknowledge`, await getAccessToken(), { method: 'POST', body: {} }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['notifications'] }); } });
  return <Screen><Text accessibilityRole="header" style={styles.title}>Notifications</Text>
    <Text style={styles.muted}>Warnings and team messages refresh every 15 seconds while online.</Text>
    {query.isPending && <Loading />}
    {query.error && <ErrorMessage error={query.error} retry={() => { void query.refetch(); }} />}
    {acknowledge.error && <ErrorMessage error={acknowledge.error} />}
    {query.data?.length === 0 && <View style={styles.card}><Text style={styles.body}>No notifications to review.</Text></View>}
    {query.data?.map(notification => <View style={styles.card} key={notification.id}>
      <View style={styles.row}><Badge>{notification.severity ?? notification.eventType ?? 'Notice'}</Badge>
        <Text style={styles.muted}>{new Date(notification.createdAtUtc).toLocaleString()}</Text></View>
      <Text style={styles.subtitle}>{notification.title ?? 'Workflow update'}</Text>
      <Text style={styles.body}>{notification.message ?? notification.eventType}</Text>
      {notification.acknowledgedAtUtc ? <Text style={styles.muted}>Acknowledged</Text>
        : <Button title="Acknowledge" secondary disabled={!online || acknowledge.isPending}
          onPress={() => acknowledge.mutate(notification.id)} />}
    </View>)}
  </Screen>;
}

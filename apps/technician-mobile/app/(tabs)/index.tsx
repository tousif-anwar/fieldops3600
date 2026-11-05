import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { requestApi } from '../src/api';
import { useAuth } from '../src/auth';
import type { WorkOrder } from '../src/contracts';
import { Badge, ErrorMessage, Loading, Screen, colors, styles } from '../src/ui';

export default function MyJobs() {
  const { session, getAccessToken } = useAuth();
  const query = useQuery({ queryKey: ['work-orders'], queryFn: async () =>
    (await requestApi<WorkOrder[]>('/api/work-orders', await getAccessToken())).data });
  const jobs = (query.data ?? []).filter(job => job.status !== 'Completed' && job.status !== 'Cancelled');
  return <Screen>
    <View><Text style={styles.muted}>WELCOME BACK, {session?.displayName.toUpperCase()}</Text>
      <Text accessibilityRole="header" style={styles.title}>My jobs</Text>
      <Text style={styles.body}>Your assigned work, ready for the next step.</Text></View>
    {query.isPending && <Loading label="Loading assigned jobs…" />}
    {query.error && <ErrorMessage error={query.error} retry={() => { void query.refetch(); }} />}
    {query.data && jobs.length === 0 && <View style={styles.card}><Text style={styles.subtitle}>You’re all caught up</Text>
      <Text style={styles.muted}>No open jobs are assigned to you.</Text></View>}
    {jobs.map(job => <Link key={job.id} href={{ pathname: '/job/[id]', params: { id: job.id } }} asChild>
      <Pressable accessibilityRole="button" style={({ pressed }) => [styles.card, { opacity: pressed ? .7 : 1 }]}>
        <View style={styles.row}><Text style={[styles.subtitle, { color: colors.blue }]}>{job.number}</Text><Badge>{job.priority}</Badge></View>
        <Text style={styles.subtitle}>{job.title}</Text>
        <Text style={styles.body}>{job.siteAddress}</Text>
        <Text style={styles.muted}>{job.serviceCategory} · {job.status}</Text>
        <Text style={styles.secondaryText}>Open job →</Text>
      </Pressable>
    </Link>)}
  </Screen>;
}

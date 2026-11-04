import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { requestApi } from '../../src/api';
import { useAuth } from '../../src/auth';
import { useRuntime } from '../../src/runtime';
import { useJob } from '../../src/use-job';
import { Badge, Button, ErrorMessage, Loading, Screen, colors, styles } from '../../src/ui';

export default function JobDetails() {
  const parameters = useLocalSearchParams<{ id: string }>();
  const id = parameters.id;
  const { online } = useRuntime();
  const { getAccessToken } = useAuth();
  const client = useQueryClient();
  const { job, workflow, workOrders, workflows } = useJob(id);
  const begin = useMutation({ mutationFn: async () =>
    requestApi('/api/workflows', await getAccessToken(), { method: 'POST', body: { workOrderId: id } }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['workflows', id] }); } });
  return <Screen>
    {workOrders.isPending && <Loading />}
    {workOrders.error && <ErrorMessage error={workOrders.error} retry={() => { void workOrders.refetch(); }} />}
    {workflows.error && <ErrorMessage error={workflows.error} retry={() => { void workflows.refetch(); }} />}
    {begin.error && <ErrorMessage error={begin.error} />}
    {workOrders.data && !job && <View style={styles.card}><Text style={styles.body}>This job is unavailable or is no longer assigned to you.</Text></View>}
    {job && <>
      <View style={styles.row}><Text style={[styles.subtitle, { color: colors.blue }]}>{job.number}</Text><Badge>{job.priority}</Badge></View>
      <Text accessibilityRole="header" style={styles.title}>{job.title}</Text>
      <View style={styles.card}><Text style={styles.subtitle}>{job.customerName}</Text>
        <Text style={styles.body}>{job.siteAddress}</Text><Text style={styles.muted}>{job.serviceCategory} · {job.status}</Text></View>
      {!workflow && workflows.isPending && <Loading label="Opening service workflow…" />}
      {!workflow && workflows.data && <View style={styles.card}>
        <Text style={styles.subtitle}>Ready to begin?</Text>
        <Text style={styles.body}>Start the guided service workflow to accept the assignment. Each stage has a server-monitored 30-minute deadline.</Text>
        <Button title={begin.isPending ? 'Starting…' : 'Start guided service'} disabled={!online || begin.isPending} onPress={() => begin.mutate()} />
      </View>}
      {workflow && <>
        <View style={styles.card}><Text style={styles.subtitle}>Service pipeline</Text>
          <Text style={styles.muted}>Template v{workflow.templateVersion} · {workflow.status} · {workflow.stages.filter(stage => ['Completed', 'Overridden'].includes(stage.status)).length} of 8 completed</Text>
          {workflow.status !== 'Completed' && <Link href={{ pathname: '/job/[id]/stage/[stage]', params: { id, stage: String(workflow.currentStageIndex) } }} style={styles.secondaryText}>Continue current stage →</Link>}
        </View>
        {workflow.stages.map(stage => <View key={stage.id} style={styles.card}>
          <View style={styles.row}><Badge>{stage.index + 1} / 8</Badge><Text style={styles.subtitle}>{stage.name}</Text></View>
          <Text style={styles.muted}>{stage.status}{stage.completedAtUtc ? ` · ${new Date(stage.completedAtUtc).toLocaleString()}` : ''}</Text>
          {(['Completed', 'Overridden'].includes(stage.status) || stage.index === workflow.currentStageIndex) &&
            <Link href={{ pathname: '/job/[id]/stage/[stage]', params: { id, stage: String(stage.index) } }} style={styles.secondaryText}>
              {['Completed', 'Overridden'].includes(stage.status) ? 'View read-only history' : 'Open stage'} →
            </Link>}
        </View>)}
      </>}
    </>}
  </Screen>;
}

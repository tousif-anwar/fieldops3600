import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { requestApi } from '../../src/api';
import { useAuth } from '../../src/auth';
import type { Notification, WorkOrder } from '../../src/contracts';
import { useBookings } from '../../src/use-bookings';
import { useJob } from '../../src/use-job';
import {
  Button, EmptyState, ErrorState, JobListItem, LoadingState, Screen, ScreenHeader,
  Section, SLAIndicator, StatusBadge,
} from '../../src/ui';
import {
  appointmentForJob, formatStatus, greetingFor, sortJobs, stageStatusTone,
} from '../../src/ui/model';
import { colors, spacing, typography } from '../../src/ui/tokens';

export default function TechnicianHome() {
  const { session, getAccessToken } = useAuth();
  const router = useRouter();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const query = useQuery({
    queryKey: ['work-orders'],
    queryFn: async () => (await requestApi<WorkOrder[]>('/api/work-orders', await getAccessToken())).data,
  });
  const bookings = useBookings();
  const notifications = useQuery({
    queryKey: ['notifications'],
    meta: { persist: false },
    queryFn: async () => (await requestApi<Notification[]>('/api/notifications', await getAccessToken())).data,
  });
  const jobs = sortJobs(
    (query.data ?? []).filter(job => job.status !== 'Completed' && job.status !== 'Cancelled'),
    bookings.data ?? [],
  );
  const active = jobs.find(job => job.status === 'InProgress');
  const service = useJob(active?.id ?? '');
  const stage = service.workflow?.stages.find(
    item => item.index === service.workflow?.currentStageIndex,
  );
  const completed = service.workflow?.stages.filter(
    item => ['Completed', 'Overridden'].includes(item.status),
  ).length ?? 0;
  const otherJobs = active ? jobs.filter(job => job.id !== active.id) : jobs;
  const date = new Date().toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const firstName = (session?.displayName ?? 'Technician').trim().split(/\s+/)[0];
  const unread = (notifications.data ?? []).filter(item => !item.acknowledgedAtUtc).length;

  return (
    <Screen topInset>
      <ScreenHeader
        title={`${greetingFor()}, ${firstName}.`}
        meta={`${date} · ${jobs.length} open job${jobs.length === 1 ? '' : 's'}`}
        description="Your current job, service deadline, and what comes next."
      />
      {query.isPending && !query.data ? <LoadingState label="Loading your work…" /> : null}
      {query.error && !query.data ? (
        <ErrorState error={query.error} retry={() => { void query.refetch(); }} />
      ) : null}
      {query.data && jobs.length === 0 ? (
        <EmptyState
          title="No open jobs assigned"
          description="New work appears here when dispatch assigns it. Your alerts and sync status remain available."
        />
      ) : null}
      {active ? (
        <Section title="Current job" description="Continue where you left off.">
          <JobListItem
            job={active}
            booking={appointmentForJob(bookings.data ?? [], active.id)}
            featured
          />
        </Section>
      ) : null}
      {active && stage ? (
        <Section
          card
          title="Current stage"
          description={`${stage.name} · ${completed} of ${service.workflow!.stages.length} stages complete`}
        >
          <View style={styles.stageRow}>
            <Text style={styles.body}>{active.number}</Text>
            <StatusBadge label={formatStatus(stage.status)} tone={stageStatusTone(stage.status)} />
          </View>
          <SLAIndicator stage={stage} now={now} online />
          <Button
            title="Continue current job"
            onPress={() => router.push({ pathname: '/job/[id]', params: { id: active.id } })}
            hint="Opens the current job and its guided service stage"
          />
        </Section>
      ) : null}
      {active && service.workflows.isPending && !stage ? (
        <LoadingState label="Checking the current service stage…" />
      ) : null}
      {unread > 0 ? (
        <Section
          card
          title="Assistance and alerts"
          description={`${unread} unread notice${unread === 1 ? '' : 's'} for your work.`}
        >
          <Text style={styles.body}>
            Review supervisor notices and SLA warnings before you continue to the site.
          </Text>
          <Button
            variant="secondary"
            title={`Review ${unread === 1 ? 'alert' : 'alerts'}`}
            onPress={() => router.push('/notifications')}
          />
        </Section>
      ) : null}
      {otherJobs.length ? (
        <Section
          title={active ? 'Upcoming work' : 'Assigned work'}
          description={active ? 'Next appointments and other open jobs.' : 'Open a job to review the site and service step.'}
        >
          <View style={styles.list}>
            {otherJobs.map(job => (
              <JobListItem
                key={job.id}
                job={job}
                booking={appointmentForJob(bookings.data ?? [], job.id)}
              />
            ))}
          </View>
        </Section>
      ) : null}
      {!active && jobs.length > 1 ? (
        <Text style={styles.footnote}>
          Your next appointment is listed first. Priority breaks ties between jobs at the same time.
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  stageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  body: { ...typography.body, color: colors.ink },
  footnote: { ...typography.small, color: colors.subtle, marginTop: spacing.xs },
});

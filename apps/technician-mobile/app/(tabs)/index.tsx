import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { requestApi } from '../../src/api';
import { useAuth } from '../../src/auth';
import type { WorkOrder } from '../../src/contracts';
import { useBookings } from '../../src/use-bookings';
import {
  EmptyState, ErrorState, JobListItem, LoadingState, Screen, ScreenHeader, Section,
} from '../../src/ui';
import { appointmentForJob, sortJobs } from '../../src/ui/model';
import { colors, spacing, typography } from '../../src/ui/tokens';

export default function MyJobs() {
  const { session, getAccessToken } = useAuth();
  const query = useQuery({
    queryKey: ['work-orders'],
    queryFn: async () => (await requestApi<WorkOrder[]>('/api/work-orders', await getAccessToken())).data,
  });
  const bookings = useBookings();
  const jobs = sortJobs(
    (query.data ?? []).filter(job => job.status !== 'Completed' && job.status !== 'Cancelled'),
    bookings.data ?? [],
  );
  const active = jobs.find(job => job.status === 'InProgress');
  const otherJobs = active ? jobs.filter(job => job.id !== active.id) : jobs;
  const date = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <Screen topInset>
      <ScreenHeader
        title="My jobs"
        meta={date}
        description={`${session?.displayName ?? 'Technician'} · ${jobs.length} open job${jobs.length === 1 ? '' : 's'}`}
      />
      {query.isPending && !query.data ? <LoadingState label="Loading assigned jobs…" /> : null}
      {query.error && !query.data ? (
        <ErrorState error={query.error} retry={() => { void query.refetch(); }} />
      ) : null}
      {query.data && jobs.length === 0 ? (
        <EmptyState
          title="You’re caught up"
          description="No open jobs are assigned to you. New work will appear here when a dispatcher assigns it."
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
      {otherJobs.length ? (
        <Section
          title={active ? 'Other assigned work' : 'Assigned work'}
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
        <Text style={styles.footnote}>Your next appointment is listed first. Priority breaks ties between jobs at the same time.</Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  footnote: { ...typography.small, color: colors.subtle, marginTop: spacing.xs },
});

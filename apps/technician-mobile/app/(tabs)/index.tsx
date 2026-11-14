import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { requestApi } from '../../src/api';
import { useAuth } from '../../src/auth';
import type { Notification } from '../../src/contracts';
import { dailyItinerary, nextStop } from '../../src/itinerary';
import { useRuntime } from '../../src/runtime';
import { useActivity } from '../../src/use-activity';
import { useBookings } from '../../src/use-bookings';
import { useJob } from '../../src/use-job';
import { useOffers } from '../../src/use-offers';
import { useWorkOrders } from '../../src/use-work-orders';
import {
  Button, EmptyState, ErrorState, JobListItem, LoadingState, Screen, ScreenHeader,
  InlineNotice, Section, SLAIndicator, StatusBadge,
} from '../../src/ui';
import {
  appointmentForJob, formatStatus, greetingFor, sortJobs, stageStatusTone,
} from '../../src/ui/model';
import { colors, spacing, typography } from '../../src/ui/tokens';
import { DirectionsButton } from '../../src/ui/directions';
import { OfferInbox } from '../../src/ui/offer-inbox';

export default function TechnicianHome() {
  const { session, getAccessToken } = useAuth();
  const { online, submissions } = useRuntime();
  const router = useRouter();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const query = useWorkOrders();
  const bookings = useBookings();
  const activity = useActivity();
  const offers = useOffers();
  const notifications = useQuery({
    queryKey: ['notifications'],
    meta: { persist: false },
    queryFn: async () => (await requestApi<Notification[]>('/api/notifications', await getAccessToken())).data,
  });
  const jobs = sortJobs(
    (query.data ?? []).filter(job => job.status !== 'Completed' && job.status !== 'Cancelled'),
    bookings.data ?? [],
  );
  const active = jobs.find(job => job.status === 'InProgress'
    || activity.data?.some(workflow => workflow.workOrderId === job.id && workflow.status === 'Active'));
  const service = useJob(active?.id ?? '');
  const stage = service.workflow?.stages.find(
    item => item.index === service.workflow?.currentStageIndex,
  );
  const completed = service.workflow?.stages.filter(
    item => ['Completed', 'Overridden'].includes(item.status),
  ).length ?? 0;
  const itinerary = dailyItinerary(bookings.data ?? [], query.data ?? [], activity.data ?? [], new Date(now));
  const next = nextStop(itinerary);
  const featured = active ?? next?.job;
  const otherJobs = featured ? jobs.filter(job => job.id !== featured.id) : jobs;
  const pending = submissions.filter(item => item.status !== 'synced').length;
  const date = new Date(now).toLocaleDateString([], {
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
        description="Your next destination, confirmed appointments, and actions for today."
      />
      <Section card title="Today at a glance" description="Confirmed appointments · device-local date">
        <View style={styles.summary}>
          <View style={styles.metric}><Text style={styles.metricValue}>{bookings.data ? itinerary.length : '—'}</Text><Text style={styles.small}>Appointments</Text></View>
          <View style={styles.metric}><Text style={styles.metricValue}>{bookings.data ? itinerary.filter(stop => stop.completed).length : '—'}</Text><Text style={styles.small}>Completed stops</Text></View>
          <View style={styles.metric}><Text style={styles.metricValue}>{pending}</Text><Text style={styles.small}>Waiting to sync</Text></View>
        </View>
        <Text style={styles.small}>Appointment times describe your bookings. Shift check-in is managed by dispatch outside this application.</Text>
        <Button title="View daily itinerary" variant="secondary" onPress={() => router.push('/schedule')} />
      </Section>
      {bookings.error ? <InlineNotice tone="warning" title="Schedule needs refreshing">{bookings.data ? 'Showing your last synchronized appointments.' : 'Connect to load confirmed appointments.'}</InlineNotice> : null}
      <OfferInbox offers={offers.data ?? []} now={now} />
      {offers.error ? <InlineNotice tone="warning" title="Offers could not be checked">New offers require a connection. Your confirmed work remains below.</InlineNotice> : null}
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
      {featured ? (
        <Section title={active ? 'Current job' : 'Next destination'} description={active ? 'Continue where you left off.' : 'Your next confirmed stop today.'}>
          <JobListItem
            job={featured}
            booking={appointmentForJob(bookings.data ?? [], featured.id)}
            featured
          />
          <DirectionsButton address={featured.siteAddress} />
          {next?.windowPassed && next.job?.id === featured.id ? (
            <InlineNotice tone="warning" title="Appointment window passed">Review the job and contact dispatch about the delay. This does not change your confirmed appointment.</InlineNotice>
          ) : null}
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
          <SLAIndicator stage={stage} now={now} online={online} />
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
          title={featured ? 'Other assigned work' : 'Assigned work'}
          description="Open a job to review its appointment, site, and current service step."
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
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  metric: { flex: 1, minWidth: 80, gap: spacing.xs },
  metricValue: { ...typography.title, color: colors.ink, fontVariant: ['tabular-nums'] },
  small: { ...typography.small, color: colors.muted },
  stageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  body: { ...typography.body, color: colors.ink },
  footnote: { ...typography.small, color: colors.subtle, marginTop: spacing.xs },
});

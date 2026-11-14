import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { SectionList, StyleSheet, Text, View, type SectionListData } from 'react-native';
import { requestApi } from '../../src/api';
import { useAuth } from '../../src/auth';
import type { AssignmentOffer, Notification, WorkOrder } from '../../src/contracts';
import { dailyItinerary, nextStop } from '../../src/itinerary';
import { useRuntime } from '../../src/runtime';
import { useActivity } from '../../src/use-activity';
import { useBookings } from '../../src/use-bookings';
import { useJob } from '../../src/use-job';
import { useOffers } from '../../src/use-offers';
import { useWorkOrders } from '../../src/use-work-orders';
import {
  Button,
  EmptyState,
  ErrorState,
  JobListItem,
  LoadingState,
  Screen,
  ScreenHeader,
  InlineNotice,
  Section,
  SLAIndicator,
  TextButton,
  listStyles,
} from '../../src/ui';
import { appointmentForJob, sortJobs } from '../../src/ui/model';
import { colors, spacing, typography } from '../../src/ui/tokens';
import { DirectionsButton } from '../../src/ui/directions';
import { OfferRow } from '../../src/ui/offer-row';
import { pendingOffers } from '../../src/offers';

type HomeItem = { kind: 'job'; job: WorkOrder } | { kind: 'offer'; offer: AssignmentOffer };

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
    queryFn: async () =>
      (await requestApi<Notification[]>('/api/notifications', await getAccessToken())).data,
  });
  const jobs = sortJobs(
    (query.data ?? []).filter((job) => job.status !== 'Completed' && job.status !== 'Cancelled'),
    bookings.data ?? [],
  );
  const active = jobs.find(
    (job) =>
      job.status === 'InProgress' ||
      activity.data?.some(
        (workflow) => workflow.workOrderId === job.id && workflow.status === 'Active',
      ),
  );
  const service = useJob(active?.id ?? '');
  const stage = service.workflow?.stages.find(
    (item) => item.index === service.workflow?.currentStageIndex,
  );
  const completed =
    service.workflow?.stages.filter((item) => ['Completed', 'Overridden'].includes(item.status))
      .length ?? 0;
  const itinerary = dailyItinerary(
    bookings.data ?? [],
    query.data ?? [],
    activity.data ?? [],
    new Date(now),
  );
  const next = nextStop(itinerary);
  const featured = active ?? next?.job;
  const otherJobs = featured ? jobs.filter((job) => job.id !== featured.id) : jobs;
  const pending = submissions.filter((item) => item.status !== 'synced').length;
  const date = new Date(now).toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const firstName = (session?.displayName ?? 'Technician').trim().split(/\s+/)[0];
  const unread = (notifications.data ?? []).filter((item) => !item.acknowledgedAtUtc).length;

  const sections: SectionListData<HomeItem>[] = [
    {
      title: 'Assignment offers',
      data: pendingOffers(offers.data ?? [], now).map((offer) => ({
        kind: 'offer' as const,
        offer,
      })),
    },
    {
      title: featured ? 'Other assigned work' : 'Assigned work',
      data: otherJobs.map((job) => ({ kind: 'job' as const, job })),
    },
  ].filter((section) => section.data.length > 0);
  const header = (
    <View style={listStyles.header}>
      <ScreenHeader title="Today" meta={`${date} · ${firstName}`} />
      <View style={styles.summary}>
        <Text style={styles.small}>
          {bookings.data ? itinerary.length : '—'} appointments ·{' '}
          {bookings.data ? itinerary.filter((stop) => stop.completed).length : '—'} complete
          {pending ? ` · ${pending} queued` : ''}
        </Text>
        <TextButton title="Itinerary" onPress={() => router.push('/schedule')} />
      </View>
      {featured ? (
        <Section title={active ? 'Current job' : 'Next destination'}>
          <JobListItem
            job={featured}
            booking={appointmentForJob(bookings.data ?? [], featured.id)}
            featured
          />
          <DirectionsButton address={featured.siteAddress} />
          {next?.windowPassed && next.job?.id === featured.id ? (
            <InlineNotice tone="warning" title="Appointment window passed">
              Contact dispatch about the delay.
            </InlineNotice>
          ) : null}
        </Section>
      ) : null}
      {active && stage ? (
        <Section
          title={stage.name}
          description={`${completed} of ${service.workflow!.stages.length} stages complete`}
        >
          <SLAIndicator stage={stage} now={now} online={online} />
          <Button
            title="Continue current job"
            onPress={() => router.push({ pathname: '/job/[id]', params: { id: active.id } })}
          />
        </Section>
      ) : null}
      {active && service.workflows.isPending && !stage ? (
        <LoadingState label="Loading current stage…" />
      ) : null}
      {unread > 0 ? (
        <TextButton
          title={`${unread} unread alerts`}
          onPress={() => router.push('/notifications')}
        />
      ) : null}
      {bookings.error ? (
        <InlineNotice tone="warning" title="Schedule not refreshed">
          {bookings.data
            ? 'Showing cached appointments.'
            : 'Connect to load confirmed appointments.'}
        </InlineNotice>
      ) : null}
      {offers.error && online ? (
        <InlineNotice tone="warning" title="Offers unavailable">
          Try again when the server is reachable.
        </InlineNotice>
      ) : null}
      {query.isPending && !query.data ? <LoadingState label="Loading assigned work…" /> : null}
      {query.error && !query.data ? (
        <ErrorState
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : null}
      {query.data && jobs.length === 0 ? (
        <EmptyState title="No open jobs assigned" description="New assignments appear here." />
      ) : null}
    </View>
  );
  return (
    <Screen topInset scrollable={false}>
      <SectionList
        sections={sections}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={listStyles.content}
        ListHeaderComponent={header}
        keyExtractor={(item) =>
          item.kind === 'job' ? `job-${item.job.id}` : `offer-${item.offer.id}`
        }
        renderSectionHeader={({ section }) => (
          <Text accessibilityRole="header" style={listStyles.section}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) =>
          item.kind === 'job' ? (
            <JobListItem
              job={item.job}
              booking={appointmentForJob(bookings.data ?? [], item.job.id)}
            />
          ) : (
            <OfferRow offer={item.offer} />
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  small: { ...typography.small, color: colors.muted, flexShrink: 1 },
});

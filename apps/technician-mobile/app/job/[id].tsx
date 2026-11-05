import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { requestApi } from '../../src/api';
import { useAuth } from '../../src/auth';
import { useRuntime } from '../../src/runtime';
import { useBookings } from '../../src/use-bookings';
import { useJob } from '../../src/use-job';
import {
  Button, EmptyState, ErrorState, InlineNotice, LoadingState, Screen, Section,
  SLAIndicator, StageProgress, StatusBadge, TextButton,
} from '../../src/ui';
import {
  appointmentForJob, formatAppointment, formatStatus, formatTimestamp, jobStatusTone,
  priorityTone, stageStatusTone,
} from '../../src/ui/model';
import { colors, spacing, typography } from '../../src/ui/tokens';

export default function JobDetails() {
  const parameters = useLocalSearchParams<{ id: string; submitted?: string }>();
  const router = useRouter();
  const id = parameters.id;
  const { online } = useRuntime();
  const { getAccessToken } = useAuth();
  const client = useQueryClient();
  const { job, workflow, workOrders, workflows } = useJob(id);
  const bookings = useBookings();
  const [showAllStages, setShowAllStages] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const begin = useMutation({
    mutationFn: async () => requestApi('/api/workflows', await getAccessToken(), {
      method: 'POST', body: { workOrderId: id },
    }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['workflows', id] }); },
  });
  const currentStage = workflow?.stages.find(stage => stage.index === workflow.currentStageIndex);
  const completedCount = workflow?.stages.filter(stage => ['Completed', 'Overridden'].includes(stage.status)).length ?? 0;
  const booking = appointmentForJob(bookings.data ?? [], id);
  const showStart = !!workflows.data && !workflow && !workflows.error;
  const footer = job && workflow && workflow.status !== 'Completed' ? (
    <Button
      title="Continue current stage"
      onPress={() => router.push({
        pathname: '/job/[id]/stage/[stage]',
        params: { id, stage: String(workflow.currentStageIndex) },
      })}
    />
  ) : job && showStart ? (
    <>
      <Button
        title={begin.isPending ? 'Starting…' : 'Start guided service'}
        loading={begin.isPending}
        disabled={!online || begin.isPending}
        onPress={() => begin.mutate()}
        hint={online ? 'Creates the eight-stage workflow' : 'Connect to start the workflow'}
      />
      <Text style={styles.footerNote}>
        {online ? 'Starting creates the server workflow and begins the first deadline.' : 'Connect to start the server workflow.'}
      </Text>
    </>
  ) : undefined;
  return (
    <Screen topInset={false} footer={footer}>
      {workOrders.isPending && !job ? <LoadingState label="Opening job…" /> : null}
      {workOrders.error && !job ? (
        <ErrorState error={workOrders.error} retry={() => { void workOrders.refetch(); }} />
      ) : null}
      {workOrders.data && !job ? (
        <EmptyState
          title="Job unavailable"
          description="This job is unavailable or is no longer assigned to you. Ask your supervisor to check the assignment."
        />
      ) : null}
      {parameters.submitted === '1' ? (
        <InlineNotice tone="success" title="Stage accepted">
          The server accepted your last stage response. Review the updated progress below.
        </InlineNotice>
      ) : null}
      {job ? (
        <>
          <View style={styles.identity}>
            <View style={styles.metaRow}>
              <Text style={styles.identifier}>{job.number}</Text>
              <View style={styles.badges}>
                <StatusBadge label={formatStatus(job.status)} tone={jobStatusTone(job.status)} />
                <StatusBadge label={formatStatus(job.priority)} tone={priorityTone(job.priority)} />
              </View>
            </View>
            <Text accessibilityRole="header" style={styles.title}>{job.title}</Text>
          </View>
          <Section
            card
            title={job.customerName}
            description={`${job.serviceCategory} · ${formatStatus(job.status)}`}
          >
            <Text style={styles.body}>{job.siteAddress}</Text>
          </Section>
          <Section card title="Appointment">
            {booking ? (
              <>
                <Text style={styles.appointment}>{formatAppointment(booking)}</Text>
                <Text style={styles.small}>Times are shown in this device’s local time zone.</Text>
              </>
            ) : (
              <Text style={styles.body}>No appointment window is available for this job. Confirm access with your supervisor before travelling.</Text>
            )}
          </Section>
          {!workflow && workflows.isPending ? <LoadingState label="Checking the service workflow…" /> : null}
          {workflows.error && !workflow ? (
            <ErrorState error={workflows.error} retry={() => { void workflows.refetch(); }} />
          ) : null}
          {begin.error ? <InlineNotice tone="danger" title="Workflow not started">{begin.error.message}</InlineNotice> : null}
          {showStart ? (
            <Section card title="Ready to begin?" description="The first stage starts a server-monitored workflow.">
              <Text style={styles.body}>
                Start the guided service to accept the assignment. The server creates
                eight stages, each with its own deadline. Save a draft as you work; only
                the server can accept a stage.
              </Text>
            </Section>
          ) : null}
          {workflow ? (
            <>
              <Section
                card
                title="Service progress"
                description={`Template v${workflow.templateVersion} · ${completedCount} of ${workflow.stages.length} stages complete`}
              >
                <StageProgress stages={workflow.stages} currentIndex={workflow.currentStageIndex} />
                {currentStage ? (
                  <>
                    <View style={styles.currentRow}>
                      <View style={styles.currentCopy}>
                        <Text style={styles.label}>Current stage</Text>
                        <Text style={styles.currentName}>{currentStage.name}</Text>
                      </View>
                      <StatusBadge label={formatStatus(currentStage.status)} tone={stageStatusTone(currentStage.status)} />
                    </View>
                    <SLAIndicator stage={currentStage} now={now} online={online} />
                  </>
                ) : (
                  <InlineNotice tone="success" title="Service complete">
                    All stages have been completed. Completed answers remain available as read-only history.
                  </InlineNotice>
                )}
              </Section>
              <Section
                title="Stage history"
                description="Completed stages are read-only. Only the current stage can accept answers."
                action={<TextButton title={showAllStages ? 'Hide history' : 'Show all 8 stages'} onPress={() => setShowAllStages(value => !value)} />}
              >
                {showAllStages ? (
                  <View style={styles.stageList}>
                    {workflow.stages.map(stage => {
                      const completed = ['Completed', 'Overridden'].includes(stage.status);
                      const actionable = completed || stage.index === workflow.currentStageIndex;
                      return (
                        <View key={stage.id} style={styles.stageRow}>
                          <View style={styles.stageIndex}><Text style={styles.stageIndexText}>{stage.index + 1}</Text></View>
                          <View style={styles.stageCopy}>
                            <Text style={styles.stageName}>{stage.name}</Text>
                            <Text style={styles.small}>
                              {formatStatus(stage.status)}
                              {stage.completedAtUtc ? ` · ${formatTimestamp(stage.completedAtUtc)}` : ''}
                            </Text>
                          </View>
                          {actionable ? (
                            <Link
                              href={{ pathname: '/job/[id]/stage/[stage]', params: { id, stage: String(stage.index) } }}
                              style={styles.stageLink}
                            >
                              {completed ? 'View' : 'Open'}
                            </Link>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={styles.small}>
                    {completedCount === 0
                      ? 'No stages have been completed yet.'
                      : `${completedCount} stage${completedCount === 1 ? '' : 's'} completed. Open the history to review answers.`}
                  </Text>
                )}
              </Section>
            </>
          ) : null}
          {workflows.isPending && workflow ? <LoadingState label="Refreshing workflow…" /> : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { gap: spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  identifier: { ...typography.identifier, color: colors.primary, flexShrink: 1 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 },
  title: { ...typography.screenTitle, fontSize: 27, lineHeight: 33, color: colors.ink },
  body: { ...typography.body, color: colors.ink },
  small: { ...typography.small, color: colors.muted },
  appointment: { ...typography.section, color: colors.ink },
  label: { ...typography.label, color: colors.subtle },
  currentRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  currentCopy: { flex: 1, gap: 2 },
  currentName: { ...typography.section, color: colors.ink },
  stageList: { gap: 0 },
  stageRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    minHeight: 56, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  stageIndex: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surfaceMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  stageIndexText: { ...typography.label, color: colors.muted, fontVariant: ['tabular-nums'] },
  stageCopy: { flex: 1, gap: 1 },
  stageName: { ...typography.body, color: colors.ink, fontWeight: '600' },
  stageLink: { ...typography.label, color: colors.primary, paddingVertical: spacing.sm },
  footerNote: { ...typography.small, color: colors.muted, textAlign: 'center' },
});

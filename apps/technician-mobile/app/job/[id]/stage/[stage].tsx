import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { requestApi } from '../../../../src/api';
import { useAuth } from '../../../../src/auth';
import type { Workflow } from '../../../../src/contracts';
import { cleanAnswers, validateField, visibleFields } from '../../../../src/offline/forms';
import { useRuntime } from '../../../../src/runtime';
import { useJob } from '../../../../src/use-job';
import {
  AssistanceSheet, Button, DropdownField, EmptyState, ErrorState, InlineNotice,
  LoadingState, Screen, Section, SLAIndicator, StageProgress, StatusBadge, SyncBadge, TextButton,
} from '../../../../src/ui';
import {
  formatStatus, formatTimestamp, friendlySyncError, humanizeFieldKey, stageStatusTone,
} from '../../../../src/ui/model';
import { colors, spacing, typography } from '../../../../src/ui/tokens';

interface Draft {
  expectedVersion: number;
  templateVersion: number;
  answers: Record<string, string>;
  savedAtUtc: string;
}

type FeedbackTone = 'success' | 'warning' | 'danger' | 'info';

export default function StageForm() {
  const parameters = useLocalSearchParams<{ id: string; stage: string; submitted?: string }>();
  const router = useRouter();
  const id = parameters.id;
  const index = Number(parameters.stage);
  const { session, getAccessToken } = useAuth();
  const { queue, online, submissions } = useRuntime();
  const client = useQueryClient();
  const { job, workflow, template, workflows } = useJob(id);
  const stage = workflow?.stages.find(item => item.index === index);
  const definition = template.data?.stages.find(item => item.index === index);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<FeedbackTone>('info');
  const [now, setNow] = useState(Date.now());
  const [saving, setSaving] = useState(false);
  const [assistanceOpen, setAssistanceOpen] = useState(false);
  const completed = stage ? ['Completed', 'Overridden'].includes(stage.status) : false;
  const current = !!workflow && workflow.currentStageIndex === index && workflow.status !== 'Completed';
  const pending = submissions.find(item => item.workflowId === workflow?.id
    && item.stageIndex === index && item.status !== 'synced');
  const draftKey = workflow ? `fieldops.draft.v1.${encodeURIComponent(session!.subject)}.${workflow.id}.${index}` : '';

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!stage || !workflow) return;
    let active = true;
    setAnswers(stage.answers ?? {});
    setFieldErrors({});
    setFeedback(null);
    setFeedbackTone('info');
    if (completed) {
      void AsyncStorage.removeItem(draftKey);
      return;
    }
    void AsyncStorage.getItem(draftKey).then(raw => {
      if (!raw || !active) return;
      const draft = JSON.parse(raw) as Draft;
      if (draft.expectedVersion === workflow.version && draft.templateVersion === workflow.templateVersion) {
        setAnswers(draft.answers);
        setFeedback(`Draft restored from ${formatTimestamp(draft.savedAtUtc)}. It has not been submitted.`);
      } else {
        setFeedback('An older draft exists, but the server workflow changed. Review the current stage before entering answers again.');
        setFeedbackTone('warning');
      }
    }).catch(() => {
      if (active) {
        setFeedback('The saved draft could not be read. Enter the stage answers again.');
        setFeedbackTone('danger');
      }
    });
    return () => { active = false; };
  }, [stage?.id, workflow?.templateVersion, draftKey, completed]);

  const assistance = useMutation({
    mutationFn: async ({ reason, detail }: { reason: string; detail: string }) => {
      const message = `${reason}${detail.trim() ? `: ${detail.trim()}` : ''}`;
      return requestApi(`/api/workflows/${encodeURIComponent(workflow!.id)}/assistance`, await getAccessToken(), {
        method: 'POST', body: { expectedVersion: workflow!.version, reason: message },
      });
    },
    onSuccess: async () => {
      setAssistanceOpen(false);
      setFeedback('Assistance requested. Your supervisor has been notified; the SLA continues unless they approve a pause.');
      setFeedbackTone('success');
      await client.invalidateQueries({ queryKey: ['workflows', id] });
    },
  });

  const saveDraft = async () => {
    if (!workflow) return;
    await AsyncStorage.setItem(draftKey, JSON.stringify({
      expectedVersion: workflow.version,
      templateVersion: workflow.templateVersion,
      answers,
      savedAtUtc: new Date().toISOString(),
    } satisfies Draft));
    setFeedback('Saved on this device. This is a draft, not a submission, and it does not pause the deadline.');
    setFeedbackTone('info');
  };

  const submit = async () => {
    if (!workflow || !definition || !stage) return;
    const errors: Record<string, string> = {};
    visibleFields(definition.fields, answers).forEach(field => {
      const message = validateField(field, answers);
      if (message) errors[field.key] = message;
    });
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setFeedback('Answer the required fields before submitting this stage.');
      setFeedbackTone('danger');
      return;
    }
    setSaving(true);
    try {
      await saveDraft();
      const submissionId = Crypto.randomUUID();
      await queue.enqueue({
        id: submissionId,
        ownerId: session!.subject,
        workOrderId: id,
        workflowId: workflow.id,
        stageIndex: index,
        expectedVersion: workflow.version,
        answers: cleanAnswers(definition.fields, answers),
        clientOccurredAtUtc: new Date().toISOString(),
        createdAt: Date.now(),
        createdOffline: !online,
      });
      setFeedback(
        online
          ? 'Submitting for server validation…'
          : 'Saved on this device. Reconnect to submit; the server deadline keeps running.',
        );
      setFeedbackTone('info');
      await queue.flush(online);
      const receipt = (await queue.list()).find(item => item.id === submissionId);
      await client.invalidateQueries({ queryKey: ['workflows', id] });
      if (receipt?.status === 'synced') {
        const latest = client.getQueryData<Workflow[]>(['workflows', id])?.[0];
        const nextIndex = latest?.status === 'Completed'
          ? null
          : Math.max(latest?.currentStageIndex ?? index + 1, index + 1);
        if (nextIndex === null || nextIndex >= (workflow.stages.length)) {
          router.replace({ pathname: '/job/[id]', params: { id, submitted: '1' } });
        } else {
          router.replace({
            pathname: '/job/[id]/stage/[stage]',
            params: { id, stage: String(nextIndex), submitted: '1' },
          });
        }
      } else if (receipt?.status === 'conflict') {
        setFeedback('The job changed on the server before this response arrived. Your answers are preserved here. Refresh the job and review the current stage before resubmitting.');
        setFeedbackTone('warning');
      } else if (receipt?.status === 'failed') {
        setFeedback(friendlySyncError(receipt.lastError));
        setFeedbackTone('danger');
      } else {
        setFeedback('Saved on this device and waiting to sync. The server deadline keeps running.');
        setFeedbackTone('warning');
      }
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : 'The stage could not be saved.');
      setFeedbackTone('danger');
    } finally {
      setSaving(false);
    }
  };

  const saveDraftSafely = () => {
    void saveDraft().catch(cause => {
      setFeedback(cause instanceof Error ? cause.message : 'The draft could not be saved.');
      setFeedbackTone('danger');
    });
  };

  const footer = current && definition ? (
    <>
      <Button
        title={saving ? 'Submitting…' : online ? 'Submit & continue' : 'Queue submission'}
        loading={saving}
        disabled={saving || !!pending || !!stage?.pausedAtUtc}
        onPress={() => { void submit(); }}
        hint={online ? 'Sends this stage to the server' : 'Saves this stage on the device until a connection returns'}
      />
      <View style={styles.footerActions}>
        <TextButton
          title="Save draft"
          disabled={saving || !!pending}
          onPress={saveDraftSafely}
          hint="Keeps answers on this device without submitting"
        />
        <TextButton
          title="Request assistance"
          disabled={!online || assistance.isPending}
          onPress={() => setAssistanceOpen(true)}
          hint={online ? 'Ask a supervisor for help' : 'Connect to request assistance'}
        />
      </View>
    </>
  ) : undefined;

  return (
    <Screen topInset={false} footer={footer}>
      {workflows.isPending && !workflow ? <LoadingState label="Opening stage…" /> : null}
      {workflows.error && !workflow ? (
        <ErrorState error={workflows.error} retry={() => { void workflows.refetch(); }} />
      ) : null}
      {workflows.data && !workflow ? (
        <EmptyState
          title="Workflow not started"
          description="Start the guided service from the job details screen before opening a stage."
        />
      ) : null}
      {workflow && !stage ? (
        <EmptyState
          title="Stage unavailable"
          description="This stage does not exist in the current workflow. Return to the job to see the active stage."
        />
      ) : null}
      {stage ? (
        <>
          <View style={styles.heading}>
            <View style={styles.metaRow}>
              <Text style={styles.identifier}>{job?.number ?? id}</Text>
              <Text style={styles.small}>Stage {index + 1} of {workflow!.stages.length}</Text>
            </View>
            <View style={styles.titleRow}>
              <Text accessibilityRole="header" style={styles.title}>{stage.name}</Text>
              <StatusBadge label={formatStatus(stage.status)} tone={stageStatusTone(stage.status)} />
            </View>
            <StageProgress stages={workflow!.stages} currentIndex={workflow!.currentStageIndex} />
          </View>
          {parameters.submitted === '1' && current ? (
            <InlineNotice tone="success" title="Stage accepted">
              The server confirmed your previous stage. Review the current stage below.
            </InlineNotice>
          ) : null}
          {current && stage.pausedAtUtc ? (
            <InlineNotice tone="warning" title="Deadline paused">
              A supervisor approved a pause. The countdown is not authoritative while paused;
              the server will resume it.
            </InlineNotice>
          ) : null}
          {current ? <SLAIndicator stage={stage} now={now} online={online} /> : null}
          {!current && !completed ? (
            <InlineNotice tone="warning" title="This stage is locked">
              Complete earlier stages in order. Your current server stage is{' '}
              {workflow?.stages.find(item => item.index === workflow.currentStageIndex)?.name ?? 'not available'}.
            </InlineNotice>
          ) : null}
          {current && pending ? (
            <InlineNotice tone="warning" title="Saved on this device">
              <View style={styles.pending}>
                <SyncBadge status={pending.status} />
                <Text style={styles.pendingText}>
                  {pending.status === 'conflict'
                    ? 'The job changed on the server before this response arrived. Your answers are preserved.'
                    : pending.status === 'failed'
                      ? friendlySyncError(pending.lastError)
                      : 'Waiting for the server to confirm this stage. The deadline continues.'}
                </Text>
                <Link href="/sync" style={styles.link}>Review sync</Link>
              </View>
            </InlineNotice>
          ) : null}
          {feedback ? <InlineNotice tone={feedbackTone}>{feedback}</InlineNotice> : null}
          {assistance.error ? (
            <InlineNotice tone="danger" title="Assistance request not sent">
              {assistance.error.message}
            </InlineNotice>
          ) : null}
          {completed ? (
            <Section card title="Completed stage" description={`Read-only history${stage.completedAtUtc ? ` · accepted ${formatTimestamp(stage.completedAtUtc)}` : ''}`}>
              {Object.entries(stage.answers ?? {}).length ? (
                <View style={styles.answers}>
                  {Object.entries(stage.answers ?? {}).map(([key, value]) => (
                    <View key={key} style={styles.answerRow}>
                      <Text style={styles.answerLabel}>
                        {definition?.fields.find(field => field.key === key)?.label ?? humanizeFieldKey(key)}
                      </Text>
                      <Text style={styles.answerValue}>{value}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.body}>No answers were recorded for this stage.</Text>
              )}
            </Section>
          ) : null}
          {current && definition ? (
            <Section card title="Service checklist" description="Choose the answer that matches what you observed.">
              <View style={styles.fields}>
                {visibleFields(definition.fields, answers).map(field => (
                  <DropdownField
                    key={field.key}
                    label={field.label}
                    value={answers[field.key] ?? ''}
                    options={field.options}
                    required={field.required}
                    disabled={!!pending || saving || !!stage.pausedAtUtc}
                    error={fieldErrors[field.key]}
                    onChange={value => {
                      setAnswers(previous => ({ ...previous, [field.key]: value }));
                      setFieldErrors(previous => {
                        if (!previous[field.key]) return previous;
                        const next = { ...previous };
                        delete next[field.key];
                        return next;
                      });
                      if (feedbackTone === 'danger') setFeedback(null);
                    }}
                  />
                ))}
              </View>
              <Text style={styles.small}>
                If none of the answers fit, request assistance. Do not select an inaccurate answer.
              </Text>
            </Section>
          ) : null}
          {current && !definition && template.isPending ? <LoadingState label="Loading stage checklist…" /> : null}
          {current && !definition && template.error ? (
            <ErrorState error={template.error} retry={() => { void template.refetch(); }} />
          ) : null}
          {current && !definition && template.data ? (
            <InlineNotice tone="warning" title="Checklist unavailable">
              This stage has no form definition on the server. Request assistance rather than guessing.
            </InlineNotice>
          ) : null}
          {!current && workflow?.status !== 'Completed' ? (
            <Link
              href={{
                pathname: '/job/[id]/stage/[stage]',
                params: { id, stage: String(workflow!.currentStageIndex) },
              }}
              style={styles.link}
            >
              Open the current stage
            </Link>
          ) : null}
          <Link href={{ pathname: '/job/[id]', params: { id } }} style={styles.link}>
            Back to job
          </Link>
        </>
      ) : null}
      <AssistanceSheet
        visible={assistanceOpen}
        online={online}
        submitting={assistance.isPending}
        error={assistance.error?.message}
        onClose={() => setAssistanceOpen(false)}
        onSubmit={(reason, detail) => assistance.mutate({ reason, detail })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  identifier: { ...typography.identifier, color: colors.primary, flexShrink: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  title: { ...typography.screenTitle, fontSize: 28, lineHeight: 34, color: colors.ink, flex: 1 },
  small: { ...typography.small, color: colors.muted },
  body: { ...typography.body, color: colors.ink },
  fields: { gap: spacing.lg },
  footerActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  pending: { gap: spacing.sm },
  pendingText: { ...typography.small, color: colors.ink },
  link: { ...typography.label, color: colors.primary, paddingVertical: spacing.sm },
  answers: { gap: spacing.md },
  answerRow: { gap: 2 },
  answerLabel: { ...typography.label, color: colors.muted },
  answerValue: { ...typography.body, color: colors.ink },
});

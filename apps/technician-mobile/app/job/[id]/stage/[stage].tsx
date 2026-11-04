import AsyncStorage from '@react-native-async-storage/async-storage';
import { Picker } from '@react-native-picker/picker';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { requestApi } from '../../../../src/api';
import { useAuth } from '../../../../src/auth';
import type { Workflow } from '../../../../src/contracts';
import { cleanAnswers, validateAnswers, visibleFields } from '../../../../src/offline/forms';
import { useRuntime } from '../../../../src/runtime';
import { useJob } from '../../../../src/use-job';
import { Badge, Button, ErrorMessage, Loading, Screen, colors, styles } from '../../../../src/ui';

interface Draft {
  expectedVersion: number;
  templateVersion: number;
  answers: Record<string, string>;
  savedAtUtc: string;
}

export default function StageForm() {
  const parameters = useLocalSearchParams<{ id: string; stage: string }>();
  const router = useRouter();
  const id = parameters.id;
  const index = Number(parameters.stage);
  const { session, getAccessToken } = useAuth();
  const { queue, online, submissions } = useRuntime();
  const client = useQueryClient();
  const { job, workflow, template, workflows } = useJob(id);
  const stage = workflow?.stages.find(stage => stage.index === index);
  const definition = template.data?.stages.find(stage => stage.index === index);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [now, setNow] = useState(Date.now());
  const [saving, setSaving] = useState(false);
  const [assistanceOpen, setAssistanceOpen] = useState(false);
  const [assistanceReason, setAssistanceReason] = useState('Need supervisor assistance');
  const [exceptionDetail, setExceptionDetail] = useState('');
  const completed = stage ? ['Completed', 'Overridden'].includes(stage.status) : false;
  const current = !!workflow && workflow.currentStageIndex === index && workflow.status !== 'Completed';
  const pending = submissions.find(item => item.workflowId === workflow?.id && item.stageIndex === index && item.status !== 'synced');
  const draftKey = workflow ? `fieldops.draft.v1.${encodeURIComponent(session!.subject)}.${workflow.id}.${index}` : '';

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!stage || !workflow) return;
    let active = true;
    setAnswers(stage.answers ?? {});
    setErrors([]);
    setFeedback(null);
    if (completed) {
      void AsyncStorage.removeItem(draftKey);
      return;
    }
    void AsyncStorage.getItem(draftKey).then(raw => {
      if (!raw || !active) return;
      const draft = JSON.parse(raw) as Draft;
      if (draft.expectedVersion === workflow.version && draft.templateVersion === workflow.templateVersion) {
        setAnswers(draft.answers);
        setFeedback(`Draft restored from ${new Date(draft.savedAtUtc).toLocaleString()}.`);
      } else {
        setFeedback('An older draft exists, but the server workflow changed. Review the current stage before entering answers again.');
      }
    }).catch(() => { if (active) setErrors(['The saved draft could not be read.']); });
    return () => { active = false; };
    // Polling can change version for SLA warnings. Keep current unsaved answers;
    // a different stage or completed history still reloads authoritative values.
  }, [stage?.id, workflow?.templateVersion, draftKey, completed]);

  const assistance = useMutation({ mutationFn: async () => {
    const reason = `${assistanceReason}${exceptionDetail.trim() ? `: ${exceptionDetail.trim()}` : ''}`;
    return requestApi(`/api/workflows/${encodeURIComponent(workflow!.id)}/assistance`, await getAccessToken(), {
      method: 'POST', body: { expectedVersion: workflow!.version, reason },
    });
  }, onSuccess: async () => {
    setFeedback('Assistance requested. Your supervisor has been notified.');
    setAssistanceOpen(false);
    await client.invalidateQueries({ queryKey: ['workflows', id] });
  } });

  const saveDraft = async () => {
    if (!workflow) return;
    await AsyncStorage.setItem(draftKey, JSON.stringify({ expectedVersion: workflow.version,
      templateVersion: workflow.templateVersion, answers, savedAtUtc: new Date().toISOString() } satisfies Draft));
    setFeedback('Draft saved on this device. This does not submit the stage or pause its deadline.');
  };

  const submit = async () => {
    if (!workflow || !definition || !stage) return;
    const invalid = validateAnswers(definition.fields, answers);
    setErrors(invalid);
    if (invalid.length) return;
    setSaving(true);
    try {
      await saveDraft();
      await queue.enqueue({ id: Crypto.randomUUID(), ownerId: session!.subject, workOrderId: id,
        workflowId: workflow.id, stageIndex: index, expectedVersion: workflow.version,
        answers: cleanAnswers(definition.fields, answers), clientOccurredAtUtc: new Date().toISOString(),
        createdAt: Date.now(), createdOffline: !online });
      setFeedback(online ? 'Submitting for server validation…' : 'Queued on this device. Reconnect to submit; the server deadline keeps running.');
      await queue.flush(online);
      await client.invalidateQueries({ queryKey: ['workflows', id] });
      const latest = client.getQueryData<Workflow[]>(['workflows', id])?.[0];
      if (latest && latest.currentStageIndex !== index && latest.status !== 'Completed') {
        router.replace({ pathname: '/job/[id]/stage/[stage]', params: { id, stage: String(latest.currentStageIndex) } });
      }
    } catch (cause) { setErrors([cause instanceof Error ? cause.message : 'Submission could not be saved.']); }
    finally { setSaving(false); }
  };

  const deadline = stage?.deadlineUtc ? new Date(stage.deadlineUtc).getTime() : null;
  const effectiveNow = stage?.pausedAtUtc ? new Date(stage.pausedAtUtc).getTime() : now;
  const remaining = deadline === null ? null : Math.floor((deadline - effectiveNow) / 1000);
  const formatRemaining = (seconds: number) => `${Math.floor(Math.abs(seconds) / 60)}:${String(Math.abs(seconds) % 60).padStart(2, '0')}`;

  return <Screen>
    {workflows.isPending && <Loading label="Opening stage…" />}
    {workflows.error && <ErrorMessage error={workflows.error} retry={() => { void workflows.refetch(); }} />}
    {template.error && <ErrorMessage error={template.error} />}
    {workflow && !stage && <View style={styles.card}><Text style={styles.error}>This stage does not exist.</Text></View>}
    {workflow && stage && <>
      <View style={styles.row}><Badge>{job?.number ?? id}</Badge><Badge>Stage {index + 1} of 8</Badge></View>
      <Text accessibilityRole="header" style={styles.title}>{stage.name}</Text>
      <View accessibilityLabel={`${workflow.stages.filter(item => ['Completed', 'Overridden'].includes(item.status)).length} of eight stages complete`} style={styles.row}>
        {workflow.stages.map(item => <View key={item.id} style={{ flex: 1, minWidth: 16, height: 7, borderRadius: 4,
          backgroundColor: ['Completed', 'Overridden'].includes(item.status) ? colors.success : item.index === index ? colors.blue : colors.border }} />)}
      </View>
      {!current && !completed && <View style={styles.card}><Text style={styles.body}>This stage is locked. Complete earlier stages in order.</Text></View>}
      {current && <View style={styles.card}>
        <Text style={styles.muted}>SERVER SLA STATUS · {stage.slaStatus}</Text>
        <Text style={[styles.title, { fontSize: 36, color: remaining !== null && remaining < 0 ? colors.danger : colors.ink }]}>
          {remaining === null ? 'Awaiting server start' : remaining < 0 ? `${formatRemaining(remaining)} overdue` : `${formatRemaining(remaining)} remaining`}
        </Text>
        <Text style={styles.muted}>{stage.pausedAtUtc ? 'Supervisor-approved pause is active.' : 'Countdown is a device estimate. The server determines warnings and breaches.'}</Text>
        {stage.deadlineUtc && <Text style={styles.muted}>Server deadline: {new Date(stage.deadlineUtc).toLocaleString()}</Text>}
      </View>}
      {completed && <View style={styles.card}><Text style={styles.subtitle}>Completed · read-only history</Text>
        <Text style={styles.muted}>{stage.completedAtUtc ? new Date(stage.completedAtUtc).toLocaleString() : ''}</Text>
        {Object.entries(stage.answers ?? {}).map(([key, value]) => <View key={key}><Text style={styles.label}>{definition?.fields.find(field => field.key === key)?.label ?? key}</Text><Text style={styles.body}>{value}</Text></View>)}
      </View>}
      {current && definition && <View style={styles.card}>
        <Text style={styles.subtitle}>Service checklist</Text>
        {visibleFields(definition.fields, answers).map(field => <View key={field.key}>
          <Text nativeID={`label-${field.key}`} style={styles.label}>{field.label}{field.required ? ' *' : ''}</Text>
          <View style={[styles.input, { paddingHorizontal: 0 }]}>
            <Picker accessibilityLabel={field.label} accessibilityLabelledBy={`label-${field.key}`}
              enabled={!pending && !saving && !stage.pausedAtUtc} selectedValue={answers[field.key] ?? ''}
              onValueChange={value => setAnswers(previous => ({ ...previous, [field.key]: String(value) }))}>
              <Picker.Item label="Select an answer…" value="" />
              {field.options.map(option => <Picker.Item key={option} label={option} value={option} />)}
            </Picker>
          </View>
        </View>)}
        <Text style={styles.muted}>If none of the answers fit, request assistance. You do not need to select an inaccurate answer.</Text>
        {pending && <View><Text style={styles.body}>Submission {pending.status}. {pending.lastError ?? 'Awaiting confirmation from the server.'}</Text><Link href="/sync" style={styles.secondaryText}>Review synchronization →</Link></View>}
        <Button title={saving ? 'Saving…' : online ? 'Submit & continue' : 'Queue submission'} disabled={saving || !!pending || !!stage.pausedAtUtc}
          onPress={() => { void submit(); }} />
        <Button title="Save draft" secondary disabled={saving || !!pending}
          onPress={() => { void saveDraft().catch(cause => setErrors([String(cause)])); }} />
        <Button title="Request assistance" secondary disabled={!online || assistance.isPending}
          onPress={() => setAssistanceOpen(value => !value)} />
      </View>}
      {current && assistanceOpen && <View style={styles.card}>
        <Text style={styles.subtitle}>Request team assistance</Text>
        <Picker accessibilityLabel="Assistance reason" selectedValue={assistanceReason} onValueChange={value => setAssistanceReason(String(value))}>
          {['Need supervisor assistance', 'Missing equipment or parts', 'Safety concern', 'Predefined answers do not fit', 'Request reassignment'].map(option => <Picker.Item key={option} value={option} label={option} />)}
        </Picker>
        <Text style={styles.label}>Optional exception details</Text>
        <TextInput accessibilityLabel="Optional exception details" style={[styles.input, { minHeight: 80 }]}
          multiline value={exceptionDetail} onChangeText={setExceptionDetail} maxLength={800} />
        <Button title={assistance.isPending ? 'Requesting…' : 'Send assistance request'} disabled={!online || assistance.isPending} onPress={() => assistance.mutate()} />
        <Text style={styles.muted}>A request does not pause the SLA. A supervisor must approve a pause.</Text>
      </View>}
      {assistance.error && <ErrorMessage error={assistance.error} />}
      {!!errors.length && <View accessibilityRole="alert" style={styles.card}>{errors.map(error => <Text key={error} style={styles.error}>{error}</Text>)}</View>}
      {feedback && <Text accessibilityLiveRegion="polite" style={styles.body}>{feedback}</Text>}
      {!current && workflow.status !== 'Completed' && <Link href={{ pathname: '/job/[id]/stage/[stage]', params: { id, stage: String(workflow.currentStageIndex) } }} style={styles.secondaryText}>Open current stage →</Link>}
      <Link href={{ pathname: '/job/[id]', params: { id } }} style={styles.secondaryText}>← Back to job</Link>
    </>}
  </Screen>;
}

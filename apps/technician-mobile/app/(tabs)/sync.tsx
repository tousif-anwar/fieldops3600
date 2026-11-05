import { Link } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useRuntime } from '../../src/runtime';
import {
  Button, EmptyState, InlineNotice, Screen, ScreenHeader, Section, StatusBadge, SyncBadge,
  TextButton,
} from '../../src/ui';
import {
  formatTimestamp, friendlySyncError, humanizeFieldKey, syncPresentation,
} from '../../src/ui/model';
import { colors, spacing, typography } from '../../src/ui/tokens';

export default function Synchronization() {
  const { queue, submissions, synchronize, online, queueError } = useRuntime();
  const pending = submissions.filter(item => item.status !== 'synced');
  const synced = submissions.filter(item => item.status === 'synced').slice(-5).reverse();
  return (
    <Screen topInset>
      <ScreenHeader
        title="Sync"
        description="See what is saved on this device and what the server has accepted."
      />
      <Section card title="Connection" description="The server remains authoritative for every submission.">
        <View style={styles.badges}>
          <StatusBadge label={online ? 'Online' : 'Offline'} tone={online ? 'success' : 'warning'} />
          <StatusBadge
            label={pending.length ? `${pending.length} waiting` : 'Everything synced'}
            tone={pending.length ? 'warning' : 'success'}
          />
        </View>
        <Text style={styles.body}>
          A saved submission is not accepted until the server confirms the current
          stage and version. The same idempotency key is reused on every retry.
        </Text>
        <Button
          title="Synchronize now"
          variant="secondary"
          disabled={!online}
          onPress={() => { void synchronize(); }}
        />
      </Section>
      {queueError ? (
        <InlineNotice tone="danger" title="Sync needs attention">
          Your work is still on this device. Check your connection and try again. If
          this persists, do not discard work until a supervisor confirms the server state.
        </InlineNotice>
      ) : null}
      {!pending.length ? (
        <EmptyState
          title="Everything is synced"
          description="There are no queued stage responses. Saved drafts remain available inside each job."
        />
      ) : (
        <Section title="Waiting to sync" description="These responses are preserved locally until the server accepts them.">
          <View style={styles.list}>
            {pending.map((item, index) => {
              const presentation = syncPresentation(item.status);
              return (
                <View key={item.id}>
                  <View style={styles.record}>
                    <View style={styles.metaRow}>
                      <SyncBadge status={item.status} />
                      <Text style={styles.small}>{formatTimestamp(item.clientOccurredAtUtc)}</Text>
                    </View>
                    <Text style={styles.title}>Stage {item.stageIndex + 1}</Text>
                    <Text style={styles.body}>{presentation.detail}</Text>
                    <View style={styles.answers}>
                      {Object.entries(item.answers).map(([key, value]) => (
                        <View key={key} style={styles.answerRow}>
                          <Text style={styles.answerKey}>{humanizeFieldKey(key)}</Text>
                          <Text style={styles.answerValue}>{value}</Text>
                        </View>
                      ))}
                    </View>
                    {item.lastError ? (
                      <InlineNotice
                        tone={item.status === 'conflict' ? 'warning' : 'danger'}
                        title={item.status === 'conflict' ? 'What changed' : 'What happened'}
                      >
                        {friendlySyncError(item.lastError)}
                      </InlineNotice>
                    ) : null}
                    {item.status === 'conflict' ? (
                      <View style={styles.actions}>
                        <Link
                          href={{ pathname: '/job/[id]', params: { id: item.workOrderId } }}
                          style={styles.link}
                        >
                          Refresh job and review current stage
                        </Link>
                        <TextButton
                          title="Discard local submission"
                          danger
                          onPress={() => confirmDiscard(queue, item.id)}
                          hint="Only removes this local copy; server history is unchanged"
                        />
                      </View>
                    ) : null}
                    {item.status === 'failed' ? (
                      <TextButton
                        title="Discard local submission"
                        danger
                        onPress={() => confirmDiscard(queue, item.id)}
                        hint="Only removes this local copy; server history is unchanged"
                      />
                    ) : null}
                  </View>
                  {index < pending.length - 1 ? <View style={styles.divider} /> : null}
                </View>
              );
            })}
          </View>
        </Section>
      )}
      {synced.length ? (
        <Section title="Recent receipts" description="Server acknowledgements for this session.">
          <View style={styles.list}>
            {synced.map(item => (
              <Text key={item.id} style={styles.receipt}>
                Stage {item.stageIndex + 1} accepted
                {item.serverReceivedAtUtc ? ` · server ${formatTimestamp(item.serverReceivedAtUtc)}` : ''}
              </Text>
            ))}
          </View>
        </Section>
      ) : null}
    </Screen>
  );
}

function confirmDiscard(queue: ReturnType<typeof useRuntime>['queue'], id: string) {
  Alert.alert(
    'Discard this local submission?',
    'This removes only the copy on this device. The server’s history is unchanged. Your current stage answers may need to be entered again.',
    [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => { void queue.discard(id); } },
    ],
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  body: { ...typography.body, color: colors.ink },
  list: { gap: 0 },
  record: { gap: spacing.sm, paddingVertical: spacing.lg },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  title: { ...typography.section, color: colors.ink },
  small: { ...typography.small, color: colors.muted },
  answers: { gap: 6, backgroundColor: colors.surfaceMuted, borderRadius: 8, padding: spacing.md },
  answerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  answerKey: { ...typography.label, color: colors.muted, minWidth: 120 },
  answerValue: { ...typography.small, color: colors.ink, flex: 1 },
  actions: { gap: spacing.sm, alignItems: 'flex-start' },
  link: { ...typography.label, color: colors.primary, paddingVertical: spacing.sm },
  receipt: { ...typography.small, color: colors.muted, paddingVertical: 6 },
  divider: { height: 1, backgroundColor: colors.border },
});

import { Link } from 'expo-router';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import type { Submission } from '../../src/offline/queue';
import { useRuntime } from '../../src/runtime';
import {
  Button,
  EmptyState,
  InlineNotice,
  Screen,
  ScreenHeader,
  StatusBadge,
  SyncBadge,
  TextButton,
  listStyles,
  textStyles,
} from '../../src/ui';
import {
  formatTimestamp,
  friendlySyncError,
  humanizeFieldKey,
  syncPresentation,
} from '../../src/ui/model';
import { spacing } from '../../src/ui/tokens';

export default function Synchronization() {
  const { queue, submissions, synchronize, online, queueError } = useRuntime();
  const pending = submissions.filter((item) => item.status !== 'synced');
  const synced = submissions
    .filter((item) => item.status === 'synced')
    .slice(-5)
    .reverse();
  const header = (
    <View style={listStyles.header}>
      <ScreenHeader title="Sync" />
      <View style={styles.badges}>
        <StatusBadge label={online ? 'Online' : 'Offline'} tone={online ? 'success' : 'warning'} />
        {pending.length > 0 ? (
          <StatusBadge label={`${pending.length} queued`} tone="warning" />
        ) : null}
      </View>
      <Text style={textStyles.body}>
        Queued responses stay on this device until the server accepts them. Conflicts require
        review.
      </Text>
      {pending.length > 0 ? (
        <Button
          title="Synchronize now"
          variant="secondary"
          disabled={!online}
          onPress={() => {
            void synchronize();
          }}
        />
      ) : null}
      {queueError ? (
        <InlineNotice tone="danger" title="Sync needs attention">
          Keep your local work until a supervisor confirms the server state. Reconnect and try
          again.
        </InlineNotice>
      ) : null}
      {!queueError && !pending.length ? (
        <EmptyState title="No queued updates" description="Saved drafts remain inside each job." />
      ) : null}
      {pending.length > 0 ? (
        <Text accessibilityRole="header" style={textStyles.heading}>
          Waiting to sync
        </Text>
      ) : null}
    </View>
  );
  const footer = synced.length ? (
    <View style={listStyles.footer}>
      <Text accessibilityRole="header" style={textStyles.heading}>
        Recent receipts
      </Text>
      {synced.map((item) => (
        <Text key={item.id} style={textStyles.secondary}>
          Stage {item.stageIndex + 1} accepted
          {item.serverReceivedAtUtc ? ` · ${formatTimestamp(item.serverReceivedAtUtc)}` : ''}
        </Text>
      ))}
    </View>
  ) : null;
  const renderSubmission = ({ item }: { item: Submission }) => {
    const presentation = syncPresentation(item.status);
    return (
      <View style={listStyles.row}>
        <View style={styles.metaRow}>
          <SyncBadge status={item.status} />
          <Text style={textStyles.secondary}>{formatTimestamp(item.clientOccurredAtUtc)}</Text>
        </View>
        <Text style={textStyles.heading}>Stage {item.stageIndex + 1}</Text>
        <Text style={textStyles.body}>{presentation.detail}</Text>
        <View style={styles.answers}>
          {Object.entries(item.answers).map(([key, value]) => (
            <Text key={key} style={textStyles.secondary}>
              <Text style={textStyles.label}>{humanizeFieldKey(key)}: </Text>
              {value}
            </Text>
          ))}
        </View>
        {item.lastError ? (
          <InlineNotice
            tone={item.status === 'conflict' ? 'warning' : 'danger'}
            title={item.status === 'conflict' ? 'Job changed' : 'Update not accepted'}
          >
            {friendlySyncError(item.lastError)}
          </InlineNotice>
        ) : null}
        {item.status === 'conflict' ? (
          <Link
            href={{ pathname: '/job/[id]', params: { id: item.workOrderId } }}
            style={textStyles.link}
          >
            Review current job
          </Link>
        ) : null}
        {item.status === 'conflict' || item.status === 'failed' ? (
          <TextButton
            title="Discard local submission"
            danger
            onPress={() => confirmDiscard(queue, item.id)}
            hint="Only removes this local copy; server history is unchanged"
          />
        ) : null}
      </View>
    );
  };
  return (
    <Screen topInset scrollable={false}>
      <FlatList
        data={pending}
        renderItem={renderSubmission}
        keyExtractor={(item) => item.id}
        contentContainerStyle={listStyles.content}
        ListHeaderComponent={header}
        ListFooterComponent={footer ?? undefined}
      />
    </Screen>
  );
}

function confirmDiscard(queue: ReturnType<typeof useRuntime>['queue'], id: string) {
  Alert.alert(
    'Discard this local submission?',
    'This removes only the copy on this device. The server’s history is unchanged. Your current stage answers may need to be entered again.',
    [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          void queue.discard(id);
        },
      },
    ],
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  answers: { gap: spacing.xs },
});

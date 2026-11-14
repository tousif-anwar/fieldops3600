import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { requestApi } from '../../src/api';
import { useAuth } from '../../src/auth';
import type { Notification } from '../../src/contracts';
import { useRuntime } from '../../src/runtime';
import {
  Button,
  EmptyState,
  ErrorState,
  InlineNotice,
  LoadingState,
  Screen,
  ScreenHeader,
  StatusBadge,
  listStyles,
  textStyles,
} from '../../src/ui';
import { formatStatus, formatTimestamp, statusTone } from '../../src/ui/model';
import { colors, spacing, typography } from '../../src/ui/tokens';

export default function Notifications() {
  const { getAccessToken } = useAuth();
  const { online } = useRuntime();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['notifications'],
    meta: { persist: false },
    refetchInterval: online ? 15_000 : false,
    queryFn: async () =>
      (await requestApi<Notification[]>('/api/notifications', await getAccessToken())).data,
  });
  const acknowledge = useMutation({
    mutationFn: async (id: string) =>
      requestApi(
        `/api/notifications/${encodeURIComponent(id)}/acknowledge`,
        await getAccessToken(),
        { method: 'POST', body: {} },
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  const header = (
    <View style={listStyles.header}>
      <ScreenHeader title="Alerts" />
      {query.isPending && !query.data ? <LoadingState label="Loading alerts…" /> : null}
      {query.error && !query.data ? (
        <ErrorState
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : null}
      {acknowledge.error ? (
        <InlineNotice tone="danger" title="Alert not acknowledged">
          {acknowledge.error.message}
        </InlineNotice>
      ) : null}
      {query.data?.length === 0 ? (
        <EmptyState
          title="No alerts"
          description="Supervisor notices and workflow warnings appear here."
        />
      ) : null}
    </View>
  );
  return (
    <Screen topInset scrollable={false}>
      <FlatList
        data={query.data ?? []}
        keyExtractor={(notification) => notification.id}
        contentContainerStyle={listStyles.content}
        ListHeaderComponent={header}
        renderItem={({ item: notification }) => (
          <View style={listStyles.row}>
            <View style={styles.metaRow}>
              <StatusBadge
                label={formatStatus(notification.severity ?? notification.eventType ?? 'Notice')}
                tone={statusTone(notification.severity ?? notification.eventType ?? 'Notice')}
              />
              <Text style={textStyles.secondary}>{formatTimestamp(notification.createdAtUtc)}</Text>
            </View>
            <Text style={styles.title}>{notification.title ?? 'Workflow update'}</Text>
            {notification.message || notification.eventType ? (
              <Text style={textStyles.bodySecondary}>
                {notification.message ?? notification.eventType}
              </Text>
            ) : null}
            {notification.acknowledgedAtUtc ? (
              <Text style={styles.acknowledged}>Acknowledged</Text>
            ) : (
              <Button
                title={acknowledge.isPending ? 'Acknowledging…' : 'Acknowledge'}
                variant="secondary"
                disabled={!online || acknowledge.isPending}
                loading={acknowledge.isPending}
                onPress={() => acknowledge.mutate(notification.id)}
              />
            )}
          </View>
        )}
      />
    </Screen>
  );
}
const styles = StyleSheet.create({
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: { ...typography.strong, color: colors.ink },
  acknowledged: { ...typography.label, color: colors.success },
});

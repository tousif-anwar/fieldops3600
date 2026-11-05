import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { requestApi } from '../../src/api';
import { useAuth } from '../../src/auth';
import type { Notification } from '../../src/contracts';
import { useRuntime } from '../../src/runtime';
import {
  Button, EmptyState, ErrorState, InlineNotice, LoadingState, Screen, ScreenHeader,
  Section, StatusBadge,
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
    queryFn: async () => (await requestApi<Notification[]>('/api/notifications', await getAccessToken())).data,
  });
  const acknowledge = useMutation({
    mutationFn: async (id: string) => requestApi(
      `/api/notifications/${encodeURIComponent(id)}/acknowledge`,
      await getAccessToken(),
      { method: 'POST', body: {} },
    ),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['notifications'] }); },
  });
  return (
    <Screen topInset>
      <ScreenHeader
        title="Alerts"
        description="Supervisor notices and workflow warnings. Updates refresh while connected."
      />
      {query.isPending && !query.data ? <LoadingState label="Loading alerts…" /> : null}
      {query.error && !query.data ? (
        <ErrorState error={query.error} retry={() => { void query.refetch(); }} />
      ) : null}
      {acknowledge.error ? <InlineNotice tone="danger" title="Alert not acknowledged">{acknowledge.error.message}</InlineNotice> : null}
      {query.data?.length === 0 ? (
        <EmptyState
          title="No alerts to review"
          description="When a supervisor or SLA event needs your attention, it will appear here."
        />
      ) : null}
      {query.data?.length ? (
        <Section title="Recent alerts" description="Acknowledge a notice once you have read it.">
          <View style={styles.list}>
            {query.data.map((notification, index) => (
              <View key={notification.id}>
                <View style={styles.item}>
                  <View style={styles.metaRow}>
                    <StatusBadge
                      label={formatStatus(notification.severity ?? notification.eventType ?? 'Notice')}
                      tone={statusTone(notification.severity ?? notification.eventType ?? 'Notice')}
                    />
                    <Text style={styles.small}>{formatTimestamp(notification.createdAtUtc)}</Text>
                  </View>
                  <Text style={styles.title}>{notification.title ?? 'Workflow update'}</Text>
                  <Text style={styles.body}>{notification.message ?? notification.eventType}</Text>
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
                {index < query.data!.length - 1 ? <View style={styles.divider} /> : null}
              </View>
            ))}
          </View>
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: 0 },
  item: { gap: spacing.sm, paddingVertical: spacing.lg },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  title: { ...typography.section, color: colors.ink },
  body: { ...typography.body, color: colors.muted },
  small: { ...typography.small, color: colors.muted },
  acknowledged: { ...typography.label, color: colors.success },
  divider: { height: 1, backgroundColor: colors.border },
});

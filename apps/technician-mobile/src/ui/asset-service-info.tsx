import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { requestApi } from '../api';
import { useAuth } from '../auth';
import type { AssetSummary, WorkOrder } from '../contracts';
import {
  assetHistoryPath,
  assetHistoryQueryKey,
  assetListPath,
  assetListQueryKey,
  validateAssetHistory,
  validateAssetList,
  warrantyStatus,
} from '../asset-context';
import { formatTimestamp } from './model';
import { useRuntime } from '../runtime';
import { ErrorState, InlineNotice, LoadingState, Section } from './components';
import { textStyles } from './styles';
import { colors, spacing, typography } from './tokens';

export function AssetServiceInfo({ job }: { job: WorkOrder }) {
  const { getAccessToken } = useAuth();
  const { online } = useRuntime();
  const path = assetListPath(job);
  const historyPath = assetHistoryPath(job);
  const query = useQuery({
    queryKey: assetListQueryKey(job),
    enabled: !!path,
    // Equipment serials are operational data; keep them out of the persisted query cache.
    meta: { persist: false },
    gcTime: 0,
    staleTime: 0,
    refetchInterval: online ? 60_000 : false,
    retry: false,
    queryFn: async () =>
      validateAssetList(
        job,
        (await requestApi<AssetSummary[]>(path!, await getAccessToken())).data,
      ),
  });
  const history = useQuery({
    queryKey: assetHistoryQueryKey(job),
    enabled: !!historyPath,
    meta: { persist: false },
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: async () =>
      validateAssetHistory(
        job,
        (
          await requestApi<Parameters<typeof validateAssetHistory>[1]>(
            historyPath!,
            await getAccessToken(),
          )
        ).data,
      ),
  });

  if (!path) return null;

  return (
    <Section title="Installed equipment">
      {query.isPending && !query.data ? (
        online ? (
          <LoadingState label="Loading installed equipment…" />
        ) : (
          <InlineNotice tone="warning">
            Connect to load the equipment installed for this customer.
          </InlineNotice>
        )
      ) : query.error ? (
        <ErrorState
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : query.data?.length ? (
        <>
          {!online ? (
            <InlineNotice tone="warning">
              Equipment was loaded earlier in this session. Reconnect before recording work against
              it.
            </InlineNotice>
          ) : null}
          {query.data.map((asset: AssetSummary) => (
            <View key={asset.id} style={styles.asset}>
              <Text style={textStyles.heading}>{asset.name}</Text>
              {asset.id === job.assetId ? (
                <Text style={styles.linked}>Linked to this job</Text>
              ) : null}
              <Text style={textStyles.body}>
                {asset.assetType} · {asset.criticality} criticality
              </Text>
              <Text style={textStyles.body}>
                {asset.manufacturer} {asset.model}
              </Text>
              <Text selectable style={styles.serial}>
                Serial {asset.serialNumber}
              </Text>
              <Text style={textStyles.secondary}>{warrantyStatus(asset)}</Text>
              {asset.status !== 'Active' ? (
                <Text style={textStyles.secondary}>Equipment status: {asset.status}</Text>
              ) : null}
            </View>
          ))}
        </>
      ) : (
        <Text style={textStyles.secondary}>No registered equipment.</Text>
      )}
      {job.assetId ? (
        <View style={styles.history}>
          <Text style={textStyles.heading}>Equipment service history</Text>
          <Text style={textStyles.secondary}>Your previous service visits.</Text>
          {history.isPending ? (
            <Text style={textStyles.secondary}>Loading linked work orders…</Text>
          ) : null}
          {history.error ? (
            <ErrorState
              error={history.error}
              retry={() => {
                void history.refetch();
              }}
            />
          ) : null}
          {history.data?.length
            ? history.data.slice(0, 5).map((order) => (
                <View key={order.id} style={styles.historyRow}>
                  <Text style={styles.serial}>
                    {order.number} · {formatTimestamp(order.createdAtUtc)}
                  </Text>
                  <Text style={textStyles.body}>{order.title}</Text>
                  <Text style={textStyles.secondary}>{order.status}</Text>
                </View>
              ))
            : null}
          {history.data && history.data.length === 0 ? (
            <Text style={textStyles.secondary}>No previous service visits.</Text>
          ) : null}
        </View>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  serial: { ...typography.body, color: colors.ink, fontVariant: ['tabular-nums'] },
  asset: {
    gap: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  linked: { ...typography.label, color: colors.primary },
  history: {
    gap: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  historyRow: { gap: spacing.xs, paddingVertical: spacing.xs },
});

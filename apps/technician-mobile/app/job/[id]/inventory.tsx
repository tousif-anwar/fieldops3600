import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { requestApi } from '../../../src/api';
import { useAuth } from '../../../src/auth';
import { useRuntime } from '../../../src/runtime';
import {
  inventoryRows,
  prepareInventoryMutation,
  type InventoryView,
} from '../../../src/inventory';
import type {
  InventoryDraft,
  InventoryAction,
  JobInventory,
} from '../../../src/inventory-contracts';
import { inventoryActions } from '../../../src/inventory-contracts';
import {
  Button,
  DropdownField,
  EmptyState,
  ErrorState,
  InlineNotice,
  LoadingState,
  Screen,
  ScreenHeader,
  Section,
  controlStyles,
  listStyles,
  textStyles,
} from '../../../src/ui';
import { spacing } from '../../../src/ui/tokens';
import { formatTimestamp } from '../../../src/ui/model';

const actions: InventoryAction[] = ['consume', 'return', 'request', 'receipt'];

export default function JobInventoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { online } = useRuntime();
  const { getAccessToken } = useAuth();
  const client = useQueryClient();
  const operationId = useRef<string | null>(null);
  const [draft, setDraft] = useState<InventoryDraft>({
    action: 'consume',
    partId: '',
    locationId: '',
    destinationLocationId: '',
    workOrderId: id,
    recordId: '',
    quantity: '',
    reason: '',
    kind: 'Additional',
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const [view, setView] = useState<InventoryView>('stock');
  const inventory = useQuery({
    queryKey: ['inventory', 'job', id],
    queryFn: async () =>
      (
        await requestApi<JobInventory>(
          `/api/inventory/work-orders/${encodeURIComponent(id)}`,
          await getAccessToken(),
        )
      ).data,
    enabled: !!id,
  });
  const mutation = useMutation({
    mutationFn: async () => {
      operationId.current ??= Crypto.randomUUID();
      const command = prepareInventoryMutation(
        { ...draft, workOrderId: id },
        operationId.current,
        online,
      );
      return requestApi(`/api/inventory${command.path}`, await getAccessToken(), {
        method: 'POST',
        body: command.body,
      });
    },
    onSuccess: async () => {
      operationId.current = null;
      setDraft((previous) => ({ ...previous, quantity: '', reason: '', recordId: '' }));
      await client.invalidateQueries({ queryKey: ['inventory', 'job', id] });
    },
  });
  const change = (key: keyof InventoryDraft, value: string) => {
    operationId.current = null;
    mutation.reset();
    setLocalError(null);
    setDraft((previous) => ({
      ...previous,
      [key]: value,
      ...(['action', 'partId', 'locationId'].includes(key) ? { recordId: '' } : {}),
      ...(key === 'recordId' && previous.action === 'consume'
        ? (() => {
            const reservation = inventory.data?.reservations.find((item) => item.id === value);
            return reservation
              ? { partId: reservation.partId, locationId: reservation.locationId }
              : {};
          })()
        : {}),
    }));
  };
  const data = inventory.data;
  const partName = (partId: string) =>
    data?.parts.find((part) => part.id === partId)?.name ?? partId;
  const locationName = (locationId: string) =>
    data?.locations.find((location) => location.id === locationId)?.name ?? locationId;
  const reservations = (data?.reservations ?? []).filter(
    (reservation) => reservation.remaining > 0,
  );
  const records =
    draft.action === 'consume'
      ? reservations.map((reservation) => ({
          id: reservation.id,
          label: `${partName(reservation.partId)} · ${reservation.remaining} reserved · ${locationName(reservation.locationId)}`,
        }))
      : draft.action === 'return'
        ? (data?.consumptions ?? [])
            .filter((consumption) => consumption.quantity > consumption.returnedQuantity)
            .map((consumption) => ({
              id: consumption.id,
              label: `${partName(consumption.partId)} · ${consumption.quantity - consumption.returnedQuantity} not returned · ${consumption.id.slice(0, 8)}`,
            }))
        : (data?.transfers ?? [])
            .filter((transfer) => transfer.status === 'InTransit')
            .map((transfer) => ({
              id: transfer.id,
              label: `${partName(transfer.partId)} · ${transfer.quantity - transfer.receivedQuantity} in transit · ${transfer.id.slice(0, 8)}`,
            }));
  const locationLabel = (location: JobInventory['locations'][number]) =>
    `${location.name} · ${location.kind} · ${location.id.slice(0, 8)}`;
  const rows = inventoryRows(data, view);
  const views: Record<InventoryView, string> = {
    stock: 'Stock balances',
    record: 'Record parts',
    requests: 'Reservations and requests',
    history: 'Movement history',
  };
  const selectedPart = data?.parts.find((part) => part.id === draft.partId);
  const selectedLocation = data?.locations.find((location) => location.id === draft.locationId);
  const selectedRecord = records.find((record) => record.id === draft.recordId);
  const submit = () => {
    try {
      prepareInventoryMutation(
        { ...draft, workOrderId: id },
        operationId.current ?? 'validate',
        online,
      );
      mutation.mutate();
    } catch (failure) {
      setLocalError(failure instanceof Error ? failure.message : 'Check the parts details.');
    }
  };
  const header = (
    <View style={listStyles.header}>
      <ScreenHeader
        title="Job parts"
        description="Stock is authoritative on the server. Changes require a connection."
      />
      {inventory.isPending ? <LoadingState label="Loading job inventory…" /> : null}
      {inventory.error ? (
        <ErrorState error={inventory.error} retry={() => void inventory.refetch()} />
      ) : null}
      {!online ? (
        <InlineNotice tone="warning" title="Connect to record parts">
          Cached balances may be stale. Parts use, returns, requests, and transfer receipts are not
          queued offline.
        </InlineNotice>
      ) : null}
      {data ? (
        <DropdownField
          label="Inventory view"
          value={views[view]}
          options={Object.values(views)}
          onChange={(label) => {
            const selected = (
              ['stock', 'record', 'requests', 'history'] satisfies InventoryView[]
            ).find((key) => views[key] === label);
            if (selected) setView(selected);
          }}
        />
      ) : null}
      {data && view === 'record' ? (
        <>
          <Section title="Record parts">
            <DropdownField
              label="Action"
              value={inventoryActions[draft.action]}
              options={actions.map((action) => inventoryActions[action])}
              disabled={!online || mutation.isPending}
              onChange={(label) => {
                const action = actions.find((item) => inventoryActions[item] === label);
                if (action) change('action', action);
              }}
            />
            {draft.action === 'consume' || draft.action === 'request' ? (
              <DropdownField
                label="Part"
                value={selectedPart ? `${selectedPart.sku} · ${selectedPart.name}` : ''}
                options={data.parts
                  .filter((part) => part.active)
                  .map((part) => `${part.sku} · ${part.name}`)}
                disabled={!online || mutation.isPending}
                required
                onChange={(label) => {
                  const part = data.parts.find((item) => `${item.sku} · ${item.name}` === label);
                  if (part) change('partId', part.id);
                }}
              />
            ) : null}
            {draft.action === 'consume' ? (
              <>
                <DropdownField
                  label="Stock location"
                  value={selectedLocation ? locationLabel(selectedLocation) : ''}
                  options={data.locations.filter((location) => location.active).map(locationLabel)}
                  disabled={!online || mutation.isPending}
                  required
                  onChange={(label) => {
                    const location = data.locations.find((item) => locationLabel(item) === label);
                    if (location) change('locationId', location.id);
                  }}
                />
                <DropdownField
                  label="Reservation"
                  value={selectedRecord?.label ?? 'Use available unreserved stock'}
                  options={[
                    'Use available unreserved stock',
                    ...records.map((record) => record.label),
                  ]}
                  disabled={!online || mutation.isPending}
                  onChange={(label) =>
                    change('recordId', records.find((record) => record.label === label)?.id ?? '')
                  }
                />
              </>
            ) : draft.action === 'return' || draft.action === 'receipt' ? (
              <DropdownField
                label={draft.action === 'return' ? 'Consumption to return' : 'Transfer to receive'}
                value={selectedRecord?.label ?? ''}
                options={records.map((record) => record.label)}
                disabled={!online || mutation.isPending}
                required
                onChange={(label) =>
                  change('recordId', records.find((record) => record.label === label)?.id ?? '')
                }
              />
            ) : null}
            <View style={styles.field}>
              <Text style={textStyles.label}>Quantity *</Text>
              <TextInput
                accessibilityLabel="Quantity, required"
                inputMode="decimal"
                value={draft.quantity}
                editable={online && !mutation.isPending}
                onChangeText={(value) => change('quantity', value)}
                maxLength={20}
                style={controlStyles.input}
              />
            </View>
            {draft.action === 'request' ? (
              <DropdownField
                label="Request type"
                value={draft.kind}
                options={['Additional', 'Missing']}
                disabled={!online || mutation.isPending}
                onChange={(value) => change('kind', value)}
              />
            ) : null}
            {draft.action === 'request' || draft.action === 'return' ? (
              <View style={styles.field}>
                <Text style={textStyles.label}>Reason *</Text>
                <TextInput
                  accessibilityLabel="Reason, required"
                  value={draft.reason}
                  editable={online && !mutation.isPending}
                  onChangeText={(value) => change('reason', value)}
                  maxLength={1000}
                  multiline
                  style={[controlStyles.input, controlStyles.multiline]}
                />
              </View>
            ) : null}
            {localError ? <InlineNotice tone="danger">{localError}</InlineNotice> : null}
            {mutation.error ? (
              <InlineNotice tone="danger" title="Parts change not confirmed">
                {mutation.error.message} Refresh stock and review movement history before creating a
                new change. Retrying unchanged details uses the original operation ID.
              </InlineNotice>
            ) : null}
            {mutation.isSuccess ? (
              <InlineNotice tone="success">Parts change recorded.</InlineNotice>
            ) : null}
            <Button
              title={inventoryActions[draft.action]}
              loading={mutation.isPending}
              disabled={!online || mutation.isPending}
              onPress={submit}
            />
            <Button
              title="Refresh stock"
              variant="secondary"
              loading={inventory.isFetching}
              onPress={() => void inventory.refetch()}
            />
          </Section>
        </>
      ) : null}
    </View>
  );
  return (
    <Screen scrollable={false}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.key}
        contentContainerStyle={listStyles.content}
        ListHeaderComponent={header}
        ListEmptyComponent={
          data && view !== 'record' ? (
            <EmptyState
              title="No records in this view"
              description="Refresh stock or choose another inventory view."
            />
          ) : undefined
        }
        renderItem={({ item }) => (
          <View style={listStyles.row}>
            <Text style={textStyles.label}>{item.label}</Text>
            <Text style={textStyles.body}>{item.detail}</Text>
            {item.warning ? <Text style={textStyles.warning}>{item.warning}</Text> : null}
            {item.time ? (
              <Text style={textStyles.secondary}>{formatTimestamp(item.time)}</Text>
            ) : null}
            {item.meta ? (
              <Text selectable style={textStyles.secondary}>
                {item.meta}
              </Text>
            ) : null}
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({ field: { gap: spacing.sm } });

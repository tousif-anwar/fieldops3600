import { inventoryCommand, type InventoryDraft, type JobInventory } from './inventory-contracts';

export type InventoryView = 'stock' | 'record' | 'requests' | 'history';
export interface InventoryRow {
  key: string;
  label: string;
  detail: string;
  warning?: string;
  meta?: string;
  time?: string;
}

export function inventoryRows(data: JobInventory | undefined, view: InventoryView): InventoryRow[] {
  if (!data || view === 'record') return [];
  const part = (id: string) => data.parts.find((item) => item.id === id)?.name ?? id;
  if (view === 'stock')
    return data.balances.map((balance) => ({
      key: `${balance.partId}:${balance.locationId}`,
      label: `${balance.sku} · ${balance.partName}`,
      detail: `${balance.locationName} · ${balance.onHand} on hand · ${balance.reserved} reserved · ${balance.available} available`,
      ...(balance.belowReorderPoint ? { warning: 'Below reorder point' } : {}),
    }));
  if (view === 'requests')
    return [
      ...data.reservations.map((item) => ({
        key: `reservation:${item.id}`,
        label: `Reservation · ${part(item.partId)}`,
        detail: `${item.remaining} remaining · ${item.status}`,
      })),
      ...data.requests.map((item) => ({
        key: `request:${item.id}`,
        label: `${item.kind} parts request · ${part(item.partId)}`,
        detail: `${item.quantity} requested · ${item.status} · ${item.reason}`,
      })),
    ];
  return data.movements.map((item) => ({
    key: item.id,
    label: `${part(item.partId)} · ${item.kind} · ${item.quantity}`,
    detail: item.reason,
    time: item.occurredAtUtc,
    meta: `${item.actorId} · ${item.correlationId}`,
  }));
}

export function prepareInventoryMutation(
  draft: InventoryDraft,
  operationId: string,
  online: boolean,
) {
  if (!online)
    throw new Error('Connect before recording parts. Inventory changes are not queued offline.');
  return inventoryCommand(draft, operationId);
}

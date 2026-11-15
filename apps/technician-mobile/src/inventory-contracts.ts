export interface InventoryPart {
  id: string;
  teamId: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  currency: string;
  unitCost: number;
  reorderPoint: number;
  reorderQuantity: number;
  active: boolean;
  version: number;
}
export interface StockLocation {
  id: string;
  teamId: string;
  name: string;
  kind: 'CentralWarehouse' | 'RegionalWarehouse' | 'Vehicle' | 'Other';
  technicianId?: string | null;
  active: boolean;
  version: number;
}
export interface StockBalance {
  partId: string;
  locationId: string;
  onHand: number;
  reserved: number;
  available: number;
  version: number;
  partName: string;
  sku: string;
  locationName: string;
  belowReorderPoint: boolean;
}
export interface InventoryReservation {
  id: string;
  partId: string;
  locationId: string;
  workOrderId: string;
  quantity: number;
  status: string;
  remaining: number;
}
export interface PartConsumption {
  id: string;
  partId: string;
  locationId: string;
  workOrderId: string;
  quantity: number;
  returnedQuantity: number;
}
export interface PartRequest {
  id: string;
  partId: string;
  workOrderId: string;
  quantity: number;
  kind: 'Missing' | 'Additional';
  reason: string;
  status: string;
}
export interface StockTransfer {
  id: string;
  partId: string;
  sourceLocationId: string;
  destinationLocationId: string;
  quantity: number;
  receivedQuantity: number;
  status: string;
}
export interface InventoryMovement {
  id: string;
  partId: string;
  quantity: number;
  kind: string;
  reason: string;
  actorId: string;
  sourceLocationId?: string | null;
  destinationLocationId?: string | null;
  workOrderId?: string | null;
  correlationId: string;
  occurredAtUtc: string;
}
export interface JobInventory {
  parts: InventoryPart[];
  locations: StockLocation[];
  balances: StockBalance[];
  reservations: InventoryReservation[];
  consumptions: PartConsumption[];
  requests: PartRequest[];
  transfers: StockTransfer[];
  movements: InventoryMovement[];
}

export const inventoryActions = {
  receive: 'Receive stock',
  reserve: 'Reserve for job',
  release: 'Release reservation',
  consume: 'Record parts used',
  return: 'Return unused parts',
  transfer: 'Dispatch transfer',
  receipt: 'Receive transfer',
  adjust: 'Adjust stock',
  request: 'Request parts',
  close: 'Close parts request',
} as const;
export type InventoryAction = keyof typeof inventoryActions;
export interface InventoryDraft {
  action: InventoryAction;
  partId: string;
  locationId: string;
  destinationLocationId: string;
  workOrderId: string;
  recordId: string;
  quantity: string;
  reason: string;
  kind: 'Missing' | 'Additional';
}
export function quantityValue(value: string, signed = false, zero = false): number {
  const valid = signed ? /^-?\d+(\.\d{1,3})?$/ : /^\d+(\.\d{1,3})?$/;
  const parsed = Number(value);
  if (
    !valid.test(value) ||
    !Number.isFinite(parsed) ||
    (zero ? parsed < 0 : parsed === 0) ||
    (!signed && parsed < 0)
  )
    throw new Error('Enter a valid quantity with no more than three decimal places.');
  return parsed;
}
export function inventoryCommand(draft: InventoryDraft, operationId: string) {
  const quantity =
    draft.action === 'close' ? 0 : quantityValue(draft.quantity, draft.action === 'adjust');
  const reason = draft.reason.trim();
  const need = (value: string, label: string) => {
    if (!value) throw new Error(`Select ${label}.`);
    return value;
  };
  const withPart = () => ({
    partId: need(draft.partId, 'a part'),
    locationId: need(draft.locationId, 'a stock location'),
    quantity,
  });
  const withJob = () => ({ ...withPart(), workOrderId: need(draft.workOrderId, 'a work order') });
  const withReason = () => {
    if (reason.length < 3) throw new Error('Enter a reason of at least three characters.');
    return reason;
  };
  switch (draft.action) {
    case 'receive':
      return { path: '/stock/receive', body: { operationId, ...withPart(), reason: withReason() } };
    case 'reserve':
      return { path: '/reservations', body: { operationId, ...withJob() } };
    case 'consume':
      return {
        path: '/consumptions',
        body: {
          operationId,
          ...withJob(),
          ...(draft.recordId ? { reservationId: draft.recordId } : {}),
        },
      };
    case 'release':
      return {
        path: `/reservations/${encodeURIComponent(need(draft.recordId, 'a reservation'))}/release`,
        body: { operationId, quantity, reason: withReason() },
      };
    case 'return':
      return {
        path: `/consumptions/${encodeURIComponent(need(draft.recordId, 'a consumption'))}/return`,
        body: { operationId, quantity, reason: withReason() },
      };
    case 'receipt':
      return {
        path: `/transfers/${encodeURIComponent(need(draft.recordId, 'a transfer'))}/receive`,
        body: { operationId, quantity },
      };
    case 'adjust':
      return {
        path: '/adjustments',
        body: {
          operationId,
          partId: need(draft.partId, 'a part'),
          locationId: need(draft.locationId, 'a stock location'),
          quantityDelta: quantity,
          reason: withReason(),
        },
      };
    case 'request':
      return {
        path: '/requests',
        body: {
          operationId,
          workOrderId: need(draft.workOrderId, 'a work order'),
          partId: need(draft.partId, 'a part'),
          quantity,
          reason: withReason(),
          kind: draft.kind,
        },
      };
    case 'close':
      return {
        path: `/requests/${encodeURIComponent(need(draft.recordId, 'a parts request'))}/close`,
        body: { operationId, reason: withReason() },
      };
    case 'transfer': {
      const sourceLocationId = need(draft.locationId, 'a source location');
      const destinationLocationId = need(draft.destinationLocationId, 'a destination location');
      if (sourceLocationId === destinationLocationId)
        throw new Error('Choose a different destination location.');
      return {
        path: '/transfers',
        body: {
          operationId,
          partId: need(draft.partId, 'a part'),
          sourceLocationId,
          destinationLocationId,
          quantity,
          ...(draft.workOrderId ? { workOrderId: draft.workOrderId } : {}),
        },
      };
    }
  }
}

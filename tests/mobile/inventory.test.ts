import assert from "node:assert/strict";
import test from "node:test";
import {
  inventoryRows,
  prepareInventoryMutation,
} from "../../apps/technician-mobile/src/inventory";
import type {
  InventoryDraft,
  JobInventory,
} from "../../apps/technician-mobile/src/inventory-contracts";

const draft: InventoryDraft = {
  action: "consume",
  partId: "part-1",
  locationId: "vehicle-1",
  destinationLocationId: "",
  workOrderId: "order-1",
  recordId: "reservation-1",
  quantity: "1.125",
  reason: "",
  kind: "Additional",
};

test("offline inventory commands are rejected instead of entering the service submission queue", () => {
  assert.throws(
    () => prepareInventoryMutation(draft, "operation-1", false),
    /not queued offline/,
  );
});
test("an unchanged consumption retry retains its original operation and reservation identity", () => {
  const first = prepareInventoryMutation(draft, "operation-1", true);
  const retry = prepareInventoryMutation(draft, "operation-1", true);
  assert.deepEqual(first, retry);
  assert.deepEqual(first, {
    path: "/consumptions",
    body: {
      operationId: "operation-1",
      partId: "part-1",
      locationId: "vehicle-1",
      quantity: 1.125,
      workOrderId: "order-1",
      reservationId: "reservation-1",
    },
  });
});
test("parts requests distinguish missing stock from additional requirements", () => {
  const request = prepareInventoryMutation(
    {
      ...draft,
      action: "request",
      kind: "Missing",
      reason: "Vehicle balance differs from physical count",
    },
    "request-1",
    true,
  );
  assert.deepEqual(request, {
    path: "/requests",
    body: {
      operationId: "request-1",
      workOrderId: "order-1",
      partId: "part-1",
      quantity: 1.125,
      reason: "Vehicle balance differs from physical count",
      kind: "Missing",
    },
  });
});
test("invalid quantities and missing job scope cannot produce a consumption request", () => {
  for (const quantity of ["0", "-1", "1.0001", "1e2", "NaN"])
    assert.throws(() =>
      prepareInventoryMutation({ ...draft, quantity }, "operation-1", true),
    );
  assert.throws(
    () =>
      prepareInventoryMutation(
        { ...draft, workOrderId: "" },
        "operation-1",
        true,
      ),
    /work order/,
  );
});

test("all authorized balances remain reachable through virtualized row data and keep server availability", () => {
  const data: JobInventory = {
    parts: [],
    locations: [],
    reservations: [],
    consumptions: [],
    requests: [],
    transfers: [],
    movements: [],
    balances: Array.from({ length: 120 }, (_, index) => ({
      partId: `part-${index}`,
      locationId: "vehicle-1",
      sku: `P${index}`,
      partName: "Service part",
      locationName: "Assigned vehicle",
      onHand: 12,
      reserved: 8,
      available: 4,
      belowReorderPoint: true,
      version: 1,
    })),
  };
  const rows = inventoryRows(data, "stock");
  assert.equal(rows.length, 120);
  assert.equal(new Set(rows.map((row) => row.key)).size, 120);
  assert.match(rows[119].detail, /12 on hand · 8 reserved · 4 available/);
  assert.equal(rows[119].warning, "Below reorder point");
  assert.deepEqual(inventoryRows(data, "record"), []);
});

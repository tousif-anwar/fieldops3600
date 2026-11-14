import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AssetSummary,
  WorkOrder,
} from "../../apps/technician-mobile/src/contracts";
import {
  assetHistoryPath,
  assetHistoryQueryKey,
  assetListPath,
  assetListQueryKey,
  validateAssetHistory,
  validateAssetList,
  warrantyStatus,
  type AssetHistoryPage,
} from "../../apps/technician-mobile/src/asset-context";

const job: WorkOrder = {
  id: "work-order-1",
  number: "WO-1",
  title: "Cooling inspection",
  customerName: "Snapshot name",
  siteAddress: "Snapshot address",
  customerId: "customer-1",
  serviceLocationId: "location-1",
  serviceCategory: "HVAC",
  priority: "Normal",
  status: "Assigned",
  teamId: "team-1",
  technicianId: "technician-1",
  createdAtUtc: "2026-11-05T12:00:00Z",
  version: 1,
};
const asset: AssetSummary = {
  id: "asset-1",
  name: "Rooftop unit",
  assetType: "HVAC",
  manufacturer: "Example",
  model: "RTU-1",
  serialNumber: "SN-0001",
  criticality: "High",
  status: "Active",
  warrantyEndUtc: "2027-06-01T00:00:00Z",
  serviceLocationId: "location-1",
};
const now = Date.parse("2026-11-05T12:00:00Z");

test("equipment is requested only for a job with a registered customer", () => {
  assert.equal(assetListPath(job), "/api/assets/by-work-order/work-order-1");
  assert.equal(assetListPath({ ...job, customerId: null }), null);
  assert.equal(
    assetListPath({ ...job, id: "work&other=2" }),
    "/api/assets/by-work-order/work%26other%3D2",
  );
});

test("equipment cache entries are isolated by job and customer", () => {
  assert.notDeepEqual(
    assetListQueryKey(job),
    assetListQueryKey({ ...job, id: "other-order" }),
  );
  assert.notDeepEqual(
    assetListQueryKey(job),
    assetListQueryKey({ ...job, customerId: "other-customer" }),
  );
});

test("incomplete equipment payloads are rejected before display", () => {
  const input = [asset];
  assert.equal(validateAssetList(job, input), input);
  assert.throws(
    () => validateAssetList({ ...job, customerId: null }, [asset]),
    /no registered customer/,
  );
  assert.throws(
    () => validateAssetList(job, null as unknown as AssetSummary[]),
    /Refresh the job/,
  );
  assert.throws(
    () => validateAssetList(job, [{ ...asset, serialNumber: "" }]),
    /incomplete/,
  );
});

test("equipment history is scoped to the linked asset and rejects foreign orders", () => {
  const linked = { ...job, assetId: "asset-1" };
  assert.equal(
    assetHistoryPath(linked),
    "/api/work-orders/by-asset/asset-1?page=1&pageSize=20",
  );
  assert.equal(assetHistoryPath({ ...linked, assetId: null }), null);
  assert.equal(
    assetHistoryPath({ ...linked, assetId: "asset&1" }),
    "/api/work-orders/by-asset/asset%261?page=1&pageSize=20",
  );
  assert.notDeepEqual(
    assetHistoryQueryKey(linked),
    assetHistoryQueryKey({ ...linked, id: "other-order" }),
  );

  const page: AssetHistoryPage = {
    items: [{ ...linked, id: "work-order-2", number: "WO-2" }],
    total: 1,
    page: 1,
    pageSize: 20,
  };
  assert.deepEqual(validateAssetHistory(linked, page), page.items);
  assert.throws(
    () =>
      validateAssetHistory(linked, {
        ...page,
        items: [{ ...linked, assetId: "asset-2" }],
      }),
    /does not match/,
  );
  assert.throws(
    () => validateAssetHistory({ ...linked, assetId: null }, page),
    /no linked equipment history/,
  );
});

test("warranty labels distinguish missing, invalid, expired and active dates", () => {
  assert.equal(
    warrantyStatus({ ...asset, warrantyEndUtc: null }, now),
    "No warranty recorded",
  );
  assert.equal(
    warrantyStatus({ ...asset, warrantyEndUtc: "not-a-date" }, now),
    "Warranty date unavailable",
  );
  assert.equal(
    warrantyStatus({ ...asset, warrantyEndUtc: "2026-11-04T00:00:00Z" }, now),
    "Warranty expired",
  );
  assert.equal(
    warrantyStatus({ ...asset, warrantyEndUtc: "2026-12-01T00:00:00Z" }, now),
    "Warranty expires within 90 days",
  );
  assert.equal(warrantyStatus(asset, now), "Warranty active");
});

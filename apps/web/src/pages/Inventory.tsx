import { useState, useSyncExternalStore, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Field, Input, Select } from "@fluentui/react-components";
import { api, post } from "../api";
import { useAuth } from "../auth";
import { dateTime } from "../format";
import {
  Empty,
  ErrorState,
  InlineMessage,
  Loading,
  PageHeader,
  Panel,
} from "../components/common";
import { ListPagination, pageSlice } from "../components/ListPagination";
import { InventoryCommandForm } from "../components/InventoryCommandForm";
import type {
  InventoryAction,
  InventoryMovement,
  InventoryPart,
  JobInventory,
  StockBalance,
  StockLocation,
  StockTransfer,
} from "../inventory-contracts";
import { quantityValue } from "../inventory-contracts";
import type { Technician, WorkOrder } from "../types";

const subscribeConnection = (callback: () => void) => {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
};

export function Inventory() {
  const auth = useAuth();
  const client = useQueryClient();
  const online = useSyncExternalStore(
    subscribeConnection,
    () => navigator.onLine,
    () => false,
  );
  const office = auth.can(
    "Dispatcher",
    "Supervisor",
    "OperationsManager",
    "Administrator",
  );
  const manage = auth.can("Supervisor", "OperationsManager", "Administrator");
  const adjust = auth.can("OperationsManager", "Administrator");
  const execute = auth.can(
    "Technician",
    "Supervisor",
    "OperationsManager",
    "Administrator",
  );
  const [workOrderId, setWorkOrderId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [tab, setTab] = useState("stock");
  const orders = useQuery({
    queryKey: ["work-orders"],
    queryFn: () => api<WorkOrder[]>("/api/work-orders"),
  });
  const parts = useQuery({
    queryKey: ["inventory", "parts"],
    queryFn: () => api<InventoryPart[]>("/api/inventory/parts"),
    enabled: office,
  });
  const locations = useQuery({
    queryKey: ["inventory", "locations"],
    queryFn: () => api<StockLocation[]>("/api/inventory/locations"),
    enabled: office,
  });
  const balances = useQuery({
    queryKey: ["inventory", "balances"],
    queryFn: () => api<StockBalance[]>("/api/inventory/balances"),
    enabled: office,
  });
  const transfers = useQuery({
    queryKey: ["inventory", "transfers"],
    queryFn: () => api<StockTransfer[]>("/api/inventory/transfers"),
    enabled: office,
  });
  const movements = useQuery({
    queryKey: ["inventory", "movements", workOrderId],
    queryFn: () =>
      api<InventoryMovement[]>(
        `/api/inventory/movements${workOrderId ? `?workOrderId=${encodeURIComponent(workOrderId)}` : ""}`,
      ),
    enabled: office,
  });
  const job = useQuery({
    queryKey: ["inventory", "job", workOrderId],
    queryFn: () =>
      api<JobInventory>(
        `/api/inventory/work-orders/${encodeURIComponent(workOrderId)}`,
      ),
    enabled: !!workOrderId,
  });
  const technicians = useQuery({
    queryKey: ["technicians"],
    queryFn: () => api<Technician[]>("/api/technicians"),
    enabled: manage,
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["inventory"] });
  const submit = async (path: string, body: unknown) => {
    const result = await post(`/api/inventory${path}`, body);
    await refresh();
    return result;
  };
  const allParts = (office ? parts.data : job.data?.parts) ?? [];
  const allLocations = (office ? locations.data : job.data?.locations) ?? [];
  const allBalances = (office ? balances.data : job.data?.balances) ?? [];
  const allTransfers = (office ? transfers.data : job.data?.transfers) ?? [];
  const actions: InventoryAction[] = manage
    ? ["receive", "reserve", "release", "transfer", "close"]
    : [];
  if (execute) actions.push("consume", "return", "receipt");
  actions.push("request");
  if (adjust) actions.push("adjust");
  const mainError =
    orders.error ??
    (office
      ? (parts.error ?? locations.error ?? balances.error ?? transfers.error)
      : null);
  const loading =
    orders.isPending ||
    (office && (parts.isPending || locations.isPending || balances.isPending));
  return (
    <>
      <PageHeader
        title="Inventory"
        description="Available = on hand − reserved. Transfers stay in transit until their receipt is recorded."
        actions={
          <Button onClick={() => void refresh()}>Refresh inventory</Button>
        }
      />
      {mainError ? (
        <ErrorState error={mainError} retry={() => void refresh()} />
      ) : null}
      {loading ? (
        <Loading label="Loading inventory…" />
      ) : (
        <>
          <Panel>
            <div className="filter-bar inventory-filters">
              <Field label="Work order">
                <Select
                  value={workOrderId}
                  onChange={(e) => setWorkOrderId(e.target.value)}
                >
                  <option value="">
                    {office
                      ? "All stock / select a job to manage job parts"
                      : "Select an assigned job"}
                  </option>
                  {orders.data?.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.number} · {o.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Location filter">
                <Select
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                >
                  <option value="">All authorized locations</option>
                  {allLocations.map((l) => (
                    <option value={l.id} key={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Inventory view">
                <Select value={tab} onChange={(e) => setTab(e.target.value)}>
                  <option value="stock">Stock balances</option>
                  <option value="job">Job reservations and requests</option>
                  <option value="transfers">Transfers</option>
                  <option value="history">Movement history</option>
                </Select>
              </Field>
            </div>
            {!office && !workOrderId ? (
              <Empty
                title="Select a job"
                description="Parts are shown only for work assigned to you."
              />
            ) : null}
            {job.isFetching && workOrderId ? (
              <Loading label="Loading job inventory…" />
            ) : null}
            {job.error ? (
              <ErrorState error={job.error} retry={() => void job.refetch()} />
            ) : null}
            {tab === "stock" ? (
              <StockTable
                rows={allBalances.filter(
                  (b) => !locationId || b.locationId === locationId,
                )}
              />
            ) : null}
            {tab === "job" ? (
              <JobParts job={job.data} parts={allParts} />
            ) : null}
            {tab === "transfers" ? (
              <TransferTable
                transfers={allTransfers}
                parts={allParts}
                locations={allLocations}
              />
            ) : null}
            {tab === "history" ? (
              movements.error ? (
                <ErrorState
                  error={movements.error}
                  retry={() => void movements.refetch()}
                />
              ) : (
                <MovementTable
                  rows={(office ? movements.data : job.data?.movements) ?? []}
                  parts={allParts}
                  locations={allLocations}
                />
              )
            ) : null}
          </Panel>
          {actions.length ? (
            <Panel
              title="Record an inventory change"
              description="Changes require a connection and are validated against current stock. After an interrupted response, review movement history before creating a new change."
            >
              <InventoryCommandForm
                key={workOrderId}
                actions={actions}
                parts={allParts}
                locations={allLocations}
                orders={orders.data ?? []}
                job={job.data}
                transfers={allTransfers}
                workOrderId={workOrderId}
                online={online}
                submit={submit}
                refresh={refresh}
              />
            </Panel>
          ) : null}
          {manage ? (
            <Panel title="Catalog and locations">
              <CatalogForms
                online={online}
                technicians={technicians.data ?? []}
                submit={submit}
              />
            </Panel>
          ) : null}
        </>
      )}
    </>
  );
}

function StockTable({ rows }: { rows: StockBalance[] }) {
  const [page, setPage] = useState(1);
  const view = pageSlice(rows, page);
  if (!rows.length)
    return (
      <Empty
        title="No stock balances"
        description="Receive a part into a stock location to establish its balance."
      />
    );
  return (
    <>
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Stock balances"
      >
        <table>
          <thead>
            <tr>
              <th>Part</th>
              <th>Location</th>
              <th>On hand</th>
              <th>Reserved</th>
              <th>Available</th>
              <th>Reorder</th>
            </tr>
          </thead>
          <tbody>
            {view.items.map((b) => (
              <tr key={`${b.partId}:${b.locationId}`}>
                <td>
                  {b.sku} · {b.partName}
                </td>
                <td>{b.locationName}</td>
                <td>{b.onHand}</td>
                <td>{b.reserved}</td>
                <td>{b.available}</td>
                <td>{b.belowReorderPoint ? "Below reorder point" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListPagination
        label="Stock balances"
        page={view.page}
        total={rows.length}
        onChange={setPage}
      />
    </>
  );
}
function JobParts({
  job,
  parts,
}: {
  job?: JobInventory;
  parts: InventoryPart[];
}) {
  if (!job)
    return (
      <Empty
        title="Choose a work order"
        description="Review the selected job’s reservations, recorded consumption, and parts requests."
      />
    );
  const name = (id: string) => parts.find((p) => p.id === id)?.name ?? id;
  return (
    <div className="form-body">
      <h3>Reservations</h3>
      {job.reservations.length ? (
        <ul>
          {job.reservations.map((r) => (
            <li key={r.id}>
              {name(r.partId)} · {r.remaining} remaining · {r.status}
            </li>
          ))}
        </ul>
      ) : (
        <p>No stock reserved.</p>
      )}
      <h3>Recorded consumption</h3>
      {job.consumptions.length ? (
        <ul>
          {job.consumptions.map((c) => (
            <li key={c.id}>
              {name(c.partId)} · {c.quantity} used · {c.returnedQuantity}{" "}
              returned
            </li>
          ))}
        </ul>
      ) : (
        <p>No parts consumed.</p>
      )}
      <h3>Parts requests</h3>
      {job.requests.length ? (
        <ul>
          {job.requests.map((r) => (
            <li key={r.id}>
              {name(r.partId)} · {r.quantity} {r.kind.toLowerCase()} ·{" "}
              {r.status} · {r.reason}
            </li>
          ))}
        </ul>
      ) : (
        <p>No parts requests.</p>
      )}
    </div>
  );
}
function TransferTable({
  transfers,
  parts,
  locations,
}: {
  transfers: StockTransfer[];
  parts: InventoryPart[];
  locations: StockLocation[];
}) {
  const [page, setPage] = useState(1);
  const view = pageSlice(transfers, page);
  if (!transfers.length) return <Empty title="No transfers" />;
  return (
    <>
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Stock transfers"
      >
        <table>
          <thead>
            <tr>
              <th>Part</th>
              <th>From</th>
              <th>To</th>
              <th>Dispatched</th>
              <th>Received</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {view.items.map((t) => (
              <tr key={t.id}>
                <td>
                  {parts.find((p) => p.id === t.partId)?.name ?? t.partId}
                </td>
                <td>
                  {locations.find((l) => l.id === t.sourceLocationId)?.name ??
                    t.sourceLocationId}
                </td>
                <td>
                  {locations.find((l) => l.id === t.destinationLocationId)
                    ?.name ?? t.destinationLocationId}
                </td>
                <td>{t.quantity}</td>
                <td>{t.receivedQuantity}</td>
                <td>{t.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListPagination
        label="Stock transfers"
        total={transfers.length}
        page={view.page}
        onChange={setPage}
      />
    </>
  );
}
function MovementTable({
  rows,
  parts,
  locations,
}: {
  rows: InventoryMovement[];
  parts: InventoryPart[];
  locations: StockLocation[];
}) {
  const [page, setPage] = useState(1);
  const view = pageSlice(rows, page);
  if (!rows.length) return <Empty title="No inventory movements" />;
  const location = (id?: string | null) =>
    id ? (locations.find((l) => l.id === id)?.name ?? id) : "—";
  return (
    <>
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Inventory movement history"
      >
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Part / action</th>
              <th>Quantity</th>
              <th>From / to</th>
              <th>Actor</th>
              <th>Reason / correlation</th>
            </tr>
          </thead>
          <tbody>
            {view.items.map((m) => (
              <tr key={m.id}>
                <td>{dateTime(m.occurredAtUtc)}</td>
                <td>
                  {parts.find((p) => p.id === m.partId)?.name ?? m.partId}
                  <br />
                  {m.kind}
                </td>
                <td>{m.quantity}</td>
                <td>
                  {location(m.sourceLocationId)} /{" "}
                  {location(m.destinationLocationId)}
                </td>
                <td>{m.actorId}</td>
                <td>
                  {m.reason}
                  <br />
                  {m.correlationId}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListPagination
        label="Movement history"
        total={rows.length}
        page={view.page}
        onChange={setPage}
      />
    </>
  );
}

function CatalogForms({
  online,
  technicians,
  submit,
}: {
  online: boolean;
  technicians: Technician[];
  submit(path: string, body: unknown): Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [attempt, setAttempt] = useState<{
    key: string;
    operationId: string;
  } | null>(null);
  const save = async (
    event: FormEvent<HTMLFormElement>,
    kind: "part" | "location",
  ) => {
    event.preventDefault();
    if (!online || busy) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      const data =
        kind === "part"
          ? {
              sku: values.sku,
              name: values.name,
              category: values.category,
              unit: values.unit,
              currency: values.currency,
              unitCost: Number(values.unitCost),
              reorderPoint: quantityValue(
                String(values.reorderPoint),
                false,
                true,
              ),
              reorderQuantity: quantityValue(
                String(values.reorderQuantity),
                false,
                true,
              ),
            }
          : {
              name: values.name,
              kind: values.kind,
              ...(values.technicianId
                ? { technicianId: values.technicianId }
                : {}),
            };
      if (kind === "part" && !/^\d+(\.\d{1,4})?$/.test(String(values.unitCost)))
        throw new Error(
          "Enter a unit cost with no more than four decimal places.",
        );
      const key = JSON.stringify({ kind, data });
      const operationId =
        attempt?.key === key ? attempt.operationId : crypto.randomUUID();
      setAttempt({ key, operationId });
      setBusy(true);
      setError(null);
      setSaved("");
      await submit(kind === "part" ? "/parts" : "/locations", {
        operationId,
        ...data,
      });
      setAttempt(null);
      form.reset();
      setSaved(
        kind === "part" ? "Part registered." : "Stock location registered.",
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Catalog change could not be recorded.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="form-body">
      <details>
        <summary>Register a part</summary>
        <form
          className="form-body"
          onSubmit={(event) => void save(event, "part")}
        >
          <Field label="SKU" required>
            <Input name="sku" required maxLength={64} />
          </Field>
          <Field label="Part name" required>
            <Input name="name" required maxLength={160} />
          </Field>
          <Field label="Category" required>
            <Input name="category" required maxLength={80} />
          </Field>
          <Field label="Unit" required>
            <Input name="unit" required maxLength={20} />
          </Field>
          <Field label="Currency (ISO code)" required>
            <Input name="currency" required minLength={3} maxLength={3} />
          </Field>
          <Field label="Unit cost" required>
            <Input name="unitCost" inputMode="decimal" required />
          </Field>
          <Field label="Reorder point" required>
            <Input
              name="reorderPoint"
              inputMode="decimal"
              required
              defaultValue="0"
            />
          </Field>
          <Field label="Reorder quantity" required>
            <Input
              name="reorderQuantity"
              inputMode="decimal"
              required
              defaultValue="0"
            />
          </Field>
          <Button type="submit" disabled={!online || busy}>
            Register part
          </Button>
        </form>
      </details>
      <details>
        <summary>Register a stock location</summary>
        <form
          className="form-body"
          onSubmit={(event) => void save(event, "location")}
        >
          <Field label="Location name" required>
            <Input name="name" required maxLength={160} />
          </Field>
          <Field label="Location kind">
            <Select name="kind">
              <option>CentralWarehouse</option>
              <option>RegionalWarehouse</option>
              <option>Vehicle</option>
              <option>Other</option>
            </Select>
          </Field>
          <Field label="Technician (vehicle only)">
            <Select name="technicianId">
              <option value="">No technician</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" disabled={!online || busy}>
            Register location
          </Button>
        </form>
      </details>
      {error ? <InlineMessage>{error}</InlineMessage> : null}
      {saved ? <InlineMessage success>{saved}</InlineMessage> : null}
    </div>
  );
}

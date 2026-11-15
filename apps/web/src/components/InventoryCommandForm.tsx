import { useRef, useState, type FormEvent } from "react";
import { Button, Field, Input, Select } from "@fluentui/react-components";
import { ApiError } from "../api";
import { InlineMessage } from "./common";
import {
  inventoryActions,
  inventoryCommand,
  type InventoryAction,
  type InventoryDraft,
  type InventoryPart,
  type JobInventory,
  type StockLocation,
  type StockTransfer,
} from "../inventory-contracts";
import type { WorkOrder } from "../types";

export const emptyInventoryDraft: InventoryDraft = {
  action: "receive",
  partId: "",
  locationId: "",
  destinationLocationId: "",
  workOrderId: "",
  recordId: "",
  quantity: "",
  reason: "",
  kind: "Additional",
};

export function InventoryCommandForm({
  actions,
  parts,
  locations,
  orders,
  job,
  transfers,
  workOrderId,
  online,
  submit,
  refresh,
}: {
  actions: InventoryAction[];
  parts: InventoryPart[];
  locations: StockLocation[];
  orders: WorkOrder[];
  job?: JobInventory;
  transfers: StockTransfer[];
  workOrderId: string;
  online: boolean;
  submit(path: string, body: unknown): Promise<unknown>;
  refresh(): Promise<unknown>;
}) {
  const [draft, setDraft] = useState<InventoryDraft>({
    ...emptyInventoryDraft,
    action: actions[0] ?? "request",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [saved, setSaved] = useState(false);
  const operation = useRef<string | null>(null);
  const action = actions.includes(draft.action) ? draft.action : actions[0];
  const change = (key: keyof InventoryDraft, value: string) => {
    operation.current = null;
    setSaved(false);
    setError(null);
    setDraft((previous) => ({
      ...previous,
      [key]: value,
      ...(["action", "partId", "locationId"].includes(key)
        ? { recordId: "" }
        : {}),
      ...(key === "recordId" && previous.action === "consume"
        ? (() => {
            const reservation = job?.reservations.find(
              (item) => item.id === value,
            );
            return reservation
              ? {
                  partId: reservation.partId,
                  locationId: reservation.locationId,
                }
              : {};
          })()
        : {}),
    }));
  };
  const partName = (id: string) => parts.find((p) => p.id === id)?.name ?? id;
  const scopedDraft = { ...draft, action, workOrderId };
  const records =
    action === "release" || action === "consume"
      ? (job?.reservations ?? [])
          .filter((r) => r.remaining > 0)
          .map((r) => ({
            id: r.id,
            label: `${partName(r.partId)} · ${r.remaining} reserved`,
          }))
      : action === "return"
        ? (job?.consumptions ?? [])
            .filter((c) => c.quantity > c.returnedQuantity)
            .map((c) => ({
              id: c.id,
              label: `${partName(c.partId)} · ${c.quantity - c.returnedQuantity} not returned · ${c.id.slice(0, 8)}`,
            }))
        : action === "receipt"
          ? transfers
              .filter((t) => t.status === "InTransit")
              .map((t) => ({
                id: t.id,
                label: `${partName(t.partId)} · ${t.quantity - t.receivedQuantity} in transit · ${t.id.slice(0, 8)}`,
              }))
          : action === "close"
            ? (job?.requests ?? [])
                .filter((r) => r.status === "Open")
                .map((r) => ({
                  id: r.id,
                  label: `${partName(r.partId)} · ${r.quantity} ${r.kind.toLowerCase()}`,
                }))
            : [];
  const needsRecord = ["release", "return", "receipt", "close"].includes(
    action,
  );
  const needsPart = [
    "receive",
    "reserve",
    "consume",
    "transfer",
    "adjust",
    "request",
  ].includes(action);
  const needsLocation = [
    "receive",
    "reserve",
    "consume",
    "transfer",
    "adjust",
  ].includes(action);
  const needsJob = [
    "reserve",
    "consume",
    "release",
    "return",
    "request",
    "close",
  ].includes(action);
  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!online || busy) return;
    setError(null);
    setSaved(false);
    try {
      operation.current ??= crypto.randomUUID();
      const command = inventoryCommand(scopedDraft, operation.current);
      setBusy(true);
      await submit(command.path, command.body);
      operation.current = null;
      setDraft((previous) => ({
        ...previous,
        quantity: "",
        reason: "",
        recordId: "",
      }));
      setSaved(true);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure
          : new Error("Inventory could not be updated."),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form-body" onSubmit={onSubmit}>
      <Field label="Inventory action">
        <Select
          value={action}
          disabled={busy}
          onChange={(e) => change("action", e.target.value)}
        >
          {actions.map((item) => (
            <option key={item} value={item}>
              {inventoryActions[item]}
            </option>
          ))}
        </Select>
      </Field>
      {needsJob ? (
        <Field label="Work order">
          <Input
            value={
              orders.find((o) => o.id === workOrderId)?.number ??
              "Select a work order above"
            }
            readOnly
          />
        </Field>
      ) : null}
      {needsPart ? (
        <Field label="Part" required>
          <Select
            value={draft.partId}
            disabled={busy}
            onChange={(e) => change("partId", e.target.value)}
          >
            <option value="">Select a part</option>
            {parts
              .filter((p) => p.active)
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.sku} · {p.name}
                </option>
              ))}
          </Select>
        </Field>
      ) : null}
      {needsLocation ? (
        <Field
          label={action === "transfer" ? "Source location" : "Stock location"}
          required
        >
          <Select
            value={draft.locationId}
            disabled={busy}
            onChange={(e) => change("locationId", e.target.value)}
          >
            <option value="">Select a location</option>
            {locations
              .filter((l) => l.active)
              .map((l) => (
                <option value={l.id} key={l.id}>
                  {l.name}
                </option>
              ))}
          </Select>
        </Field>
      ) : null}
      {action === "transfer" ? (
        <Field label="Destination location" required>
          <Select
            value={draft.destinationLocationId}
            disabled={busy}
            onChange={(e) => change("destinationLocationId", e.target.value)}
          >
            <option value="">Select a destination</option>
            {locations
              .filter((l) => l.active && l.id !== draft.locationId)
              .map((l) => (
                <option value={l.id} key={l.id}>
                  {l.name}
                </option>
              ))}
          </Select>
        </Field>
      ) : null}
      {needsRecord || action === "consume" ? (
        <Field
          label={
            action === "consume" ? "Reservation (optional)" : "Inventory record"
          }
          required={needsRecord}
        >
          <Select
            value={draft.recordId}
            disabled={busy}
            onChange={(e) => change("recordId", e.target.value)}
          >
            <option value="">
              {action === "consume"
                ? "Use available unreserved stock"
                : "Select a record"}
            </option>
            {records.map((r) => (
              <option value={r.id} key={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {action !== "close" ? (
        <Field
          label={action === "adjust" ? "Quantity change" : "Quantity"}
          required
        >
          <Input
            inputMode="decimal"
            value={draft.quantity}
            disabled={busy}
            maxLength={20}
            onChange={(e) => change("quantity", e.target.value)}
          />
        </Field>
      ) : null}
      {action === "request" ? (
        <Field label="Request type">
          <Select
            value={draft.kind}
            disabled={busy}
            onChange={(e) => change("kind", e.target.value)}
          >
            <option>Additional</option>
            <option>Missing</option>
          </Select>
        </Field>
      ) : null}
      {["receive", "release", "return", "adjust", "request", "close"].includes(
        action,
      ) ? (
        <Field label="Reason" required>
          <Input
            value={draft.reason}
            disabled={busy}
            maxLength={1000}
            onChange={(e) => change("reason", e.target.value)}
          />
        </Field>
      ) : null}
      {!online ? (
        <InlineMessage>
          Connect to record inventory changes. Stock mutations are not queued
          offline.
        </InlineMessage>
      ) : null}
      {error ? (
        <InlineMessage>
          {error.message}
          {error instanceof ApiError && error.status === 409
            ? " Refresh inventory and review the latest stock and quantities before trying again."
            : ""}
        </InlineMessage>
      ) : null}
      {error instanceof ApiError && error.status === 409 ? (
        <Button
          onClick={async () => {
            await refresh();
            setError(null);
          }}
        >
          Refresh inventory
        </Button>
      ) : null}
      {saved ? (
        <InlineMessage success>Inventory change recorded.</InlineMessage>
      ) : null}
      <div className="form-actions">
        <Button
          appearance="primary"
          type="submit"
          disabled={!online || busy || (needsJob && !workOrderId)}
        >
          {busy ? "Recording…" : inventoryActions[action]}
        </Button>
      </div>
    </form>
  );
}

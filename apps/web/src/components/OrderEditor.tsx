import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Dialog,
  DialogSurface,
  Field,
  Input,
  Select,
} from "@fluentui/react-components";
import { api } from "../api";
import { InlineMessage } from "./common";
import type { WorkOrder } from "../types";

export function OrderEditor({
  order,
  onClose,
}: {
  order: WorkOrder;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(order.title);
  const [priority, setPriority] = useState(order.priority);
  const [status, setStatus] = useState(order.status);
  const update = useMutation({
    mutationFn: () =>
      api<WorkOrder>(`/api/work-orders/${order.id}`, {
        method: "PUT",
        body: JSON.stringify({
          expectedVersion: order.version,
          title,
          priority,
          status,
        }),
      }),
    onSuccess: (next) => {
      qc.setQueryData(["work-order", order.id], next);
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(_, data) => {
        if (!data.open) onClose();
      }}
    >
      <DialogSurface className="modal" aria-labelledby="order-edit-title">
        <span className="eyebrow">
          {order.number} · VERSION {order.version}
        </span>
        <h2 id="order-edit-title">Update service request</h2>
        <p>
          Workflow state controls service completion. Cancel any confirmed
          booking first. Only unassigned requests may be cancelled.
        </p>
        <form
          className="editor-form"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate();
          }}
        >
          <Field label="Work order title" required>
            <Input
              autoFocus
              required
              minLength={3}
              maxLength={160}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="Priority">
            <Select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              {["Low", "Normal", "High", "Critical"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value={order.status}>{order.status}</option>
              {order.status === "Created" && (
                <option value="Cancelled">Cancelled</option>
              )}
            </Select>
          </Field>
          {update.isError && (
            <InlineMessage>{update.error.message}</InlineMessage>
          )}
          <div className="form-actions">
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              appearance="primary"
              type="submit"
              disabled={update.isPending}
            >
              {update.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

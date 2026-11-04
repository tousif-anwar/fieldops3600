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
import { api, post } from "../api";
import { dateTime } from "../format";
import { InlineMessage } from "./common";
import type { Booking } from "../types";

export function BookingEditor({
  booking,
  action,
  onClose,
}: {
  booking: Booking;
  action: "reschedule" | "cancel";
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [start, setStart] = useState(() => {
    const d = new Date(booking.startUtc);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  });
  const [duration, setDuration] = useState(
    String(
      Math.round(
        (Date.parse(booking.endUtc) - Date.parse(booking.startUtc)) / 60000,
      ),
    ),
  );
  const [reason, setReason] = useState("");
  const update = useMutation({
    mutationFn: () =>
      action === "cancel"
        ? post<Booking>(`/api/bookings/${booking.id}/cancel`, {
            expectedVersion: booking.version,
            reason,
          })
        : api<Booking>(`/api/bookings/${booking.id}`, {
            method: "PUT",
            body: JSON.stringify({
              expectedVersion: booking.version,
              startUtc: new Date(start).toISOString(),
              endUtc: new Date(
                Date.parse(start) + Number(duration) * 60000,
              ).toISOString(),
              reason,
            }),
          }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["bookings"] });
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
      <DialogSurface className="modal" aria-labelledby="booking-edit-title">
        <span className="eyebrow">AUDITED DISPATCH CHANGE</span>
        <h2 id="booking-edit-title">
          {action === "cancel"
            ? "Cancel this booking?"
            : "Reschedule appointment"}
        </h2>
        <p>
          {booking.technicianId} · Currently {dateTime(booking.startUtc)}.{" "}
          {action === "cancel"
            ? "The cancellation is recorded in operational history."
            : "Qualifications, working hours, and overlapping appointments are checked again."}
        </p>
        <form
          className="editor-form"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate();
          }}
        >
          {action === "reschedule" && (
            <>
              <Field label="New start (your local time)" required>
                <Input
                  required
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </Field>
              <Field label="Duration">
                <Select
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                >
                  {[30, 60, 90, 120, 180, 240].map((v) => (
                    <option key={v} value={v}>
                      {v} minutes
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
          <Field label="Reason" required>
            <Input
              required
              minLength={3}
              maxLength={240}
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain this dispatch change"
            />
          </Field>
          {update.isError && (
            <InlineMessage>{update.error.message}</InlineMessage>
          )}
          <div className="form-actions">
            <Button type="button" onClick={onClose}>
              Keep appointment
            </Button>
            <Button
              appearance="primary"
              type="submit"
              disabled={update.isPending}
            >
              {update.isPending
                ? "Saving…"
                : action === "cancel"
                  ? "Confirm cancellation"
                  : "Confirm new time"}
            </Button>
          </div>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

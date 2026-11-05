import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Button, Field, Input, Select } from "@fluentui/react-components";
import {
  CalendarDays,
  Check,
  Clock3,
  MapPin,
  Sparkles,
  Users,
} from "lucide-react";
import { api, post } from "../api";
import { useAuth } from "../auth";
import { dateTime, time } from "../format";
import {
  Empty,
  ErrorState,
  InlineMessage,
  Loading,
  PageHeader,
  Panel,
  Status,
} from "../components/common";
import type { Booking, Recommendation, Technician, WorkOrder } from "../types";
import { BookingEditor } from "../components/BookingEditor";

export function Schedule() {
  const [editing, setEditing] = useState<{
    booking: Booking;
    action: "reschedule" | "cancel";
  } | null>(null);
  const auth = useAuth();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const [workOrderId, setOrder] = useState(params.get("workOrderId") ?? "");
  const [start, setStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  });
  const [duration, setDuration] = useState("120");
  const [strategy, setStrategy] = useState("baseline");
  const [selected, setSelected] = useState("");
  const [reason, setReason] = useState("");
  const orders = useQuery({
    queryKey: ["work-orders"],
    queryFn: () => api<WorkOrder[]>("/api/work-orders"),
  });
  const techs = useQuery({
    queryKey: ["technicians"],
    queryFn: () => api<Technician[]>("/api/technicians"),
    enabled: auth.can("Dispatcher", "Supervisor", "OperationsManager"),
  });
  const bookings = useQuery({
    queryKey: ["bookings"],
    queryFn: () => api<Booking[]>("/api/bookings"),
  });
  const startUtc = useMemo(
    () =>
      start && !Number.isNaN(Date.parse(start))
        ? new Date(start).toISOString()
        : "",
    [start],
  );
  const endUtc = startUtc
    ? new Date(Date.parse(startUtc) + Number(duration) * 60000).toISOString()
    : "";
  const recommendations = useMutation({
    mutationFn: () =>
      post<Recommendation[]>("/api/scheduling/recommendations", {
        workOrderId,
        startUtc,
        durationMinutes: Number(duration),
        strategy,
      }),
  });
  const confirm = useMutation({
    mutationFn: () =>
      post<Booking>("/api/bookings", {
        workOrderId,
        technicianId: selected,
        startUtc,
        endUtc,
        overrideReason: reason || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["bookings"] });
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      setSelected("");
    },
  });
  return (
    <>
      <PageHeader
        eyebrow="DISPATCH & CAPACITY"
        title="Dispatch board"
        description="Assign qualified technicians, review availability, and prevent overlapping bookings."
      />
      <div className="schedule-grid">
        {auth.can("Dispatcher", "OperationsManager") && (
          <Panel
            title="Plan an appointment"
            description="Recommendations explain why a technician is a suitable match."
          >
            <div className="form-body">
              <Field label="Work order" required>
                <Select
                  value={workOrderId}
                  disabled={recommendations.isPending}
                  onChange={(e) => {
                    setOrder(e.target.value);
                    recommendations.reset();
                    setSelected("");
                  }}
                >
                  <option value="">Choose a work order</option>
                  {orders.data
                    ?.filter(
                      (w) =>
                        w.status !== "Completed" && w.status !== "Cancelled",
                    )
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.number} — {w.title}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Appointment start (your local time)" required>
                <Input
                  type="datetime-local"
                  value={start}
                  disabled={recommendations.isPending}
                  onChange={(e) => {
                    setStart(e.target.value);
                    recommendations.reset();
                    setSelected("");
                  }}
                />
              </Field>
              <div className="form-two">
                <Field label="Duration">
                  <Select
                    value={duration}
                    disabled={recommendations.isPending}
                    onChange={(e) => {
                      setDuration(e.target.value);
                      recommendations.reset();
                      setSelected("");
                    }}
                  >
                    {[30, 60, 90, 120, 180, 240].map((v) => (
                      <option value={v} key={v}>
                        {v} minutes
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Dispatch strategy">
                  <Select
                    value={strategy}
                    disabled={recommendations.isPending}
                    onChange={(e) => {
                      setStrategy(e.target.value);
                      recommendations.reset();
                      setSelected("");
                    }}
                  >
                    <option value="baseline">
                      Baseline suitability ranking
                    </option>
                    <option value="optimized">OR-Tools optimization</option>
                  </Select>
                </Field>
              </div>
              <Button
                appearance="primary"
                icon={<Sparkles size={16} />}
                disabled={
                  !workOrderId || !startUtc || recommendations.isPending
                }
                onClick={() => recommendations.mutate()}
              >
                {recommendations.isPending
                  ? "Checking availability…"
                  : "Find qualified technicians"}
              </Button>
              {recommendations.isError && (
                <InlineMessage>{recommendations.error.message}</InlineMessage>
              )}
              {recommendations.data && (
                <div className="recommendations">
                  <h3>Recommended technicians</h3>
                  {recommendations.data.length === 0 ? (
                    <Empty
                      title="No feasible assignments"
                      description="Try a different time or review required qualifications."
                    />
                  ) : (
                    recommendations.data.map((r, index) => (
                      <label
                        key={r.technicianId}
                        className={`recommendation ${selected === r.technicianId ? "selected" : ""}`}
                      >
                        <input
                          type="radio"
                          name="technician"
                          checked={selected === r.technicianId}
                          onChange={() => setSelected(r.technicianId)}
                        />
                        <div>
                          <strong>
                            {techs.data?.find((t) => t.id === r.technicianId)
                              ?.name ??
                              r.technicianName ??
                              r.technicianId}
                            {index === 0 && (
                              <span className="best-match">BEST MATCH</span>
                            )}
                          </strong>
                          <p>
                            {r.explanation?.join(" · ") ??
                              r.reasons?.join(" · ") ??
                              `Suitability score: ${r.score.toFixed(1)}`}
                          </p>
                          <small>
                            Score {r.score.toFixed(1)} · All hard constraints
                            checked
                            {r.solverStatus && (
                              <>
                                {" "}
                                · {r.solverStatus} ·{" "}
                                {r.runtimeMilliseconds?.toFixed(1)} ms
                              </>
                            )}
                          </small>
                        </div>
                      </label>
                    ))
                  )}
                  <Field
                    label="Override or dispatch reason"
                    required={
                      !!selected &&
                      selected !== recommendations.data?.[0]?.technicianId
                    }
                    hint="A reason is required when choosing a different recommendation."
                  >
                    <Input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Optional dispatch context"
                    />
                  </Field>
                  <Button
                    appearance="primary"
                    disabled={
                      !selected ||
                      confirm.isPending ||
                      (selected !== recommendations.data?.[0]?.technicianId &&
                        reason.trim().length < 3)
                    }
                    icon={<Check size={16} />}
                    onClick={() => confirm.mutate()}
                  >
                    {confirm.isPending ? "Confirming…" : "Confirm booking"}
                  </Button>
                </div>
              )}
              {confirm.isError && (
                <InlineMessage>{confirm.error.message}</InlineMessage>
              )}
              {confirm.isSuccess && (
                <InlineMessage success>
                  Booking confirmed. The technician is now assigned.
                </InlineMessage>
              )}
            </div>
          </Panel>
        )}
        <Panel
          title="Confirmed appointments"
          description="Overlapping confirmed bookings are rejected by the database."
          action={
            <span className="count-pill">
              {bookings.data?.filter((b) => b.status === "Confirmed").length ??
                0}{" "}
              booked
            </span>
          }
        >
          {bookings.isPending ? (
            <Loading />
          ) : bookings.isError ? (
            <ErrorState
              error={bookings.error}
              retry={() => void bookings.refetch()}
            />
          ) : !bookings.data?.length ? (
            <Empty
              title="Space to plan your day"
              description="Confirmed appointments will appear here with their assigned technician."
            />
          ) : (
            <div className="booking-list">
              {[...bookings.data]
                .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc))
                .map((b) => (
                  <article className="booking-card" key={b.id}>
                    <div className="booking-time">
                      <CalendarDays size={18} />
                      <strong>{time(b.startUtc)}</strong>
                      <small>{time(b.endUtc)}</small>
                    </div>
                    <div className="booking-content">
                      <div>
                        <strong>
                          {orders.data?.find((w) => w.id === b.workOrderId)
                            ?.title ?? b.workOrderId.slice(0, 8)}
                        </strong>
                        <Status value={b.status} />
                      </div>
                      <p>
                        <Users size={14} />
                        {techs.data?.find((t) => t.id === b.technicianId)
                          ?.name ?? b.technicianId}
                      </p>
                      <p>
                        <MapPin size={14} />
                        {orders.data?.find((w) => w.id === b.workOrderId)
                          ?.siteAddress ?? "Authorized service location"}
                      </p>
                      <small>
                        <Clock3 size={12} />
                        {dateTime(b.startUtc)} ·{" "}
                        {Math.round(
                          (Date.parse(b.endUtc) - Date.parse(b.startUtc)) /
                            60000,
                        )}{" "}
                        min
                      </small>
                      {b.status === "Confirmed" &&
                        auth.can("Dispatcher", "OperationsManager") && (
                          <div className="booking-actions">
                            <Button
                              size="small"
                              onClick={() =>
                                setEditing({ booking: b, action: "reschedule" })
                              }
                            >
                              Reschedule
                            </Button>
                            <Button
                              size="small"
                              appearance="subtle"
                              onClick={() =>
                                setEditing({ booking: b, action: "cancel" })
                              }
                            >
                              Cancel booking
                            </Button>
                          </div>
                        )}
                    </div>
                  </article>
                ))}
            </div>
          )}
        </Panel>
      </div>
      {editing && (
        <BookingEditor
          booking={editing.booking}
          action={editing.action}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

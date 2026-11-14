import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Button, Field, Input, Select } from "@fluentui/react-components";
import {
  CalendarDays,
  Check,
  Clock3,
  MapPin,
  RefreshCw,
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
import { AssignmentOffers } from "../components/AssignmentOffers";
import type { AssignmentOffer } from "../assignment-contracts";

export function Schedule() {
  const [editorOpen, setEditorOpen] = useState(false);
  const restoreFocusTarget = useRestoreFocusTarget();
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
  const [assignmentMode, setAssignmentMode] = useState("direct");
  const [offerMinutes, setOfferMinutes] = useState("30");
  const offerCommand = useRef<{
    idempotencyKey: string;
    expiresAtUtc: string;
  } | null>(null);
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
    refetchInterval: 10000,
  });
  const startUtc =
    start && !Number.isNaN(Date.parse(start))
      ? new Date(start).toISOString()
      : "";
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
      void qc.invalidateQueries({ queryKey: ["assignment-offers"] });
      setSelected("");
    },
    onError: () => {
      void qc.invalidateQueries({ queryKey: ["bookings"] });
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
    },
  });
  const sendOffer = useMutation({
    mutationFn: () => {
      offerCommand.current ??= {
        idempotencyKey: crypto.randomUUID(),
        expiresAtUtc: new Date(
          Math.min(
            Date.now() + Number(offerMinutes) * 60000,
            Date.parse(startUtc),
          ),
        ).toISOString(),
      };
      return post<AssignmentOffer>("/api/assignment-offers", {
        workOrderId,
        technicianId: selected,
        startUtc,
        endUtc,
        ...offerCommand.current,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["assignment-offers"] });
      setSelected("");
      offerCommand.current = null;
    },
    onError: () => {
      void qc.invalidateQueries({ queryKey: ["assignment-offers"] });
      void qc.invalidateQueries({ queryKey: ["bookings"] });
    },
  });
  const busy =
    recommendations.isPending || confirm.isPending || sendOffer.isPending;
  const resetPlan = () => {
    recommendations.reset();
    confirm.reset();
    sendOffer.reset();
    setSelected("");
    setReason("");
    offerCommand.current = null;
  };
  const refreshDispatch = () => {
    void orders.refetch();
    void bookings.refetch();
    void qc.invalidateQueries({ queryKey: ["assignment-offers"] });
    resetPlan();
  };
  return (
    <>
      <PageHeader
        title="Dispatch board"
        actions={
          <Button
            icon={<RefreshCw aria-hidden="true" size={16} />}
            disabled={busy}
            onClick={refreshDispatch}
          >
            Refresh dispatch
          </Button>
        }
      />
      {orders.isError && (
        <ErrorState error={orders.error} retry={() => void orders.refetch()} />
      )}
      {techs.isError && (
        <ErrorState error={techs.error} retry={() => void techs.refetch()} />
      )}
      <div
        className={`schedule-grid ${auth.can("Dispatcher", "OperationsManager") ? "" : "schedule-review"}`}
      >
        {auth.can("Dispatcher", "OperationsManager") && (
          <Panel title="Plan an appointment">
            <div className="form-body">
              <Field label="Work order" required>
                <Select
                  name="work-order"
                  value={workOrderId}
                  disabled={busy}
                  onChange={(e) => {
                    setOrder(e.target.value);
                    resetPlan();
                  }}
                >
                  <option value="">Choose a work order</option>
                  {orders.data
                    ?.filter(
                      (w) =>
                        w.status === "Created" &&
                        !bookings.data?.some(
                          (b) =>
                            b.workOrderId === w.id && b.status === "Confirmed",
                        ),
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
                  name="appointment-start-your-local-time"
                  autoComplete="off"
                  type="datetime-local"
                  value={start}
                  disabled={busy}
                  onChange={(e) => {
                    setStart(e.target.value);
                    resetPlan();
                  }}
                />
              </Field>
              <div className="form-two">
                <Field label="Duration">
                  <Select
                    name="duration"
                    value={duration}
                    disabled={busy}
                    onChange={(e) => {
                      setDuration(e.target.value);
                      resetPlan();
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
                    name="dispatch-strategy"
                    value={strategy}
                    disabled={busy}
                    onChange={(e) => {
                      setStrategy(e.target.value);
                      resetPlan();
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
                icon={<Sparkles aria-hidden="true" size={16} />}
                disabled={
                  !workOrderId ||
                  !startUtc ||
                  busy ||
                  orders.isPending ||
                  bookings.isPending ||
                  orders.isError ||
                  bookings.isError
                }
                onClick={() => {
                  confirm.reset();
                  sendOffer.reset();
                  setSelected("");
                  offerCommand.current = null;
                  recommendations.mutate();
                }}
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
                        aria-label={r.technicianName ?? r.technicianId}
                        htmlFor={`recommendation-${r.technicianId}`}
                        key={r.technicianId}
                        className={`recommendation ${selected === r.technicianId ? "selected" : ""}`}
                      >
                        <input
                          autoComplete="off"
                          type="radio"
                          id={`recommendation-${r.technicianId}`}
                          name="technician"
                          checked={selected === r.technicianId}
                          disabled={busy}
                          onChange={() => {
                            setSelected(r.technicianId);
                            confirm.reset();
                            sendOffer.reset();
                            offerCommand.current = null;
                          }}
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
                  <Field label="Assignment method">
                    <Select
                      name="assignment-method"
                      value={assignmentMode}
                      disabled={busy}
                      onChange={(e) => {
                        setAssignmentMode(e.target.value);
                        confirm.reset();
                        sendOffer.reset();
                        offerCommand.current = null;
                      }}
                    >
                      <option value="direct">
                        Dispatcher confirms booking
                      </option>
                      <option value="offer">Offer to technician</option>
                    </Select>
                  </Field>
                  {assignmentMode === "offer" && (
                    <>
                      <Field
                        label="Offer response time"
                        hint="The offer expires at the appointment start if it comes sooner."
                      >
                        <Select
                          name="offer-response-time"
                          value={offerMinutes}
                          disabled={busy}
                          onChange={(e) => {
                            setOfferMinutes(e.target.value);
                            sendOffer.reset();
                            offerCommand.current = null;
                          }}
                        >
                          {[15, 30, 60, 240].map((minutes) => (
                            <option key={minutes} value={minutes}>
                              {minutes} minutes
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <p className="muted">
                        Offers do not reserve capacity. Eligibility is checked
                        on acceptance.
                      </p>
                    </>
                  )}
                  {assignmentMode === "direct" && (
                    <Field
                      label="Override or dispatch reason"
                      required={
                        !!selected &&
                        selected !== recommendations.data?.[0]?.technicianId
                      }
                      hint="A reason is required when choosing a different recommendation."
                    >
                      <Input
                        name="override-or-dispatch-reason"
                        autoComplete="off"
                        value={reason}
                        disabled={busy}
                        maxLength={500}
                        onChange={(e) => {
                          setReason(e.target.value);
                          confirm.reset();
                        }}
                        placeholder="Optional dispatch context"
                      />
                    </Field>
                  )}
                  {assignmentMode === "direct" && (
                    <p className="muted">
                      A confirmed booking revokes any pending offer for this
                      order.
                    </p>
                  )}
                  <Button
                    appearance="primary"
                    disabled={
                      !selected ||
                      busy ||
                      (assignmentMode === "direct" &&
                        selected !== recommendations.data?.[0]?.technicianId &&
                        reason.trim().length < 3)
                    }
                    icon={<Check aria-hidden="true" size={16} />}
                    onClick={() =>
                      assignmentMode === "offer"
                        ? sendOffer.mutate()
                        : confirm.mutate()
                    }
                  >
                    {sendOffer.isPending
                      ? "Sending offer…"
                      : confirm.isPending
                        ? "Confirming…"
                        : assignmentMode === "offer"
                          ? "Send assignment offer"
                          : "Confirm booking"}
                  </Button>
                </div>
              )}
              {confirm.isError && (
                <InlineMessage>
                  {confirm.error.message} Refresh dispatch and check
                  availability before retrying.
                </InlineMessage>
              )}
              {sendOffer.isError && (
                <InlineMessage>
                  {sendOffer.error.message} The offer has not been confirmed
                  here. Refresh offers to check its status.
                </InlineMessage>
              )}
              {sendOffer.isSuccess && (
                <InlineMessage success>
                  Offer sent. Awaiting technician acceptance; no booking is
                  confirmed yet.
                </InlineMessage>
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
          title="Appointments"

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
              title="No appointments"
              description="Confirm a booking to add an appointment."
            />
          ) : (
            <div className="booking-list">
              {[...bookings.data]
                .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc))
                .map((b) => (
                  <article className="booking-card" key={b.id}>
                    <div className="booking-time">
                      <CalendarDays aria-hidden="true" size={18} />
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
                        <Users aria-hidden="true" size={14} />
                        {techs.data?.find((t) => t.id === b.technicianId)
                          ?.name ?? b.technicianId}
                      </p>
                      <p>
                        <MapPin aria-hidden="true" size={14} />
                        {orders.data?.find((w) => w.id === b.workOrderId)
                          ?.siteAddress ?? "Authorized service location"}
                      </p>
                      <small>
                        <Clock3 aria-hidden="true" size={12} />
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
                              {...restoreFocusTarget}
                              onClick={() => {setEditing({ booking: b, action: "reschedule" }); setEditorOpen(true);}}
                            >
                              Reschedule
                            </Button>
                            <Button
                              size="small"
                              appearance="subtle"
                              {...restoreFocusTarget}
                              onClick={() => {setEditing({ booking: b, action: "cancel" }); setEditorOpen(true);}}
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
      <AssignmentOffers
        technicians={techs.data ?? []}
        canManage={auth.can("Dispatcher", "OperationsManager")}
      />
      {editing && (
        <BookingEditor
          booking={editing.booking}
          open={editorOpen}
          action={editing.action}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </>
  );
}

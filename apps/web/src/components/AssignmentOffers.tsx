import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Button,
  useRestoreFocusTarget,
  Dialog,
  DialogSurface,
  Field,
  Input,
} from "@fluentui/react-components";
import { Clock3, MapPin, RefreshCw, Users } from "lucide-react";
import { api, post } from "../api";
import { offerStatus, type AssignmentOffer } from "../assignment-contracts";
import { ListPagination, pageSlice } from "./ListPagination";
import { dateTime } from "../format";
import type { Technician } from "../types";
import {
  Empty,
  ErrorState,
  InlineMessage,
  Loading,
  Panel,
  Status,
} from "./common";

export function AssignmentOffers({
  technicians,
  canManage,
}: {
  technicians: Technician[];
  canManage: boolean;
}) {
  const [revoking, setRevoking] = useState<AssignmentOffer | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [showHistory, setShowHistory] = useState(false);
  const [now, setNow] = useState(Date.now());
  const offers = useQuery({
    queryKey: ["assignment-offers"],
    queryFn: () => api<AssignmentOffer[]>("/api/assignment-offers"),
    refetchInterval: 10000,
  });
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10000);
    return () => window.clearInterval(timer);
  }, []);
  const pending = (offers.data ?? []).filter(
    (offer) => offerStatus(offer, now) === "Pending",
  );
  const visible = showHistory ? (offers.data ?? []) : pending;
  const rows = pageSlice(
    [...visible].sort(
      (a, b) => Date.parse(b.createdAtUtc) - Date.parse(a.createdAtUtc),
    ),
    page,
  );
  const technicianById = new Map(
    technicians.map((technician) => [technician.id, technician]),
  );
  return (
    <>
      <Panel
        title="Assignment offers"
        description="Offers await technician acceptance. Appointment capacity is checked again when accepted."
        action={
          <Button
            size="small"
            appearance="subtle"
            icon={<RefreshCw aria-hidden="true" size={15} />}
            disabled={offers.isFetching}
            onClick={() => void offers.refetch()}
          >
            Refresh offers
          </Button>
        }
      >
        <div className="offer-toolbar">
          <span className="count-pill">{pending.length} awaiting response</span>
          <Button
            size="small"
            appearance="subtle"
            onClick={() => {
              setShowHistory(!showHistory);
              setPage(1);
            }}
          >
            {showHistory ? "Show pending only" : "Show offer history"}
          </Button>
          <span className="muted">Refreshes every 10 seconds</span>
        </div>
        {offers.isPending ? (
          <Loading label="Loading assignment offers…" />
        ) : offers.isError ? (
          <ErrorState
            error={offers.error}
            retry={() => void offers.refetch()}
          />
        ) : visible.length === 0 ? (
          <Empty
            title={showHistory ? "No assignment offers" : "No pending offers"}
            description="Choose ‘Offer to technician’ when planning an appointment. A booking is confirmed only after acceptance."
          />
        ) : (
          <div className="booking-list">
            {rows.items.map((offer) => {
              const status = offerStatus(offer, now);
              return (
                <article className="booking-card offer-card" key={offer.id}>
                  <div className="booking-content">
                    <div>
                      <Link to={`/work-orders/${offer.workOrderId}`}>
                        <strong>
                          {offer.workOrderNumber} · {offer.title}
                        </strong>
                      </Link>
                      <Status value={status} />
                    </div>
                    <p>
                      <Users aria-hidden="true" size={14} />
                      {technicianById.get(offer.technicianId)?.name ??
                        offer.technicianId}
                      {" · "}
                      {offer.serviceCategory}
                      {" · "}
                      {offer.priority}
                    </p>
                    <p>
                      <MapPin aria-hidden="true" size={14} />
                      {offer.siteAddress}
                    </p>
                    <p>
                      <Clock3 aria-hidden="true" size={14} />
                      {dateTime(offer.startUtc)} – {dateTime(offer.endUtc)}
                    </p>
                    <small>
                      {status === "Pending" ? "Accept before" : "Offer expiry"}{" "}
                      {dateTime(offer.expiresAtUtc)}
                      {offer.respondedAtUtc &&
                        ` · Responded ${dateTime(offer.respondedAtUtc)}`}
                    </small>
                    {offer.reason && (
                      <p className="offer-reason">Reason: {offer.reason}</p>
                    )}
                    {status === "Accepted" && (
                      <p>Booking confirmed on acceptance.</p>
                    )}
                    {status === "Declined" && (
                      <p>Ready for a new offer or direct assignment.</p>
                    )}
                    {status === "Expired" && (
                      <p>
                        Acceptance closed. Review availability before sending a
                        new offer.
                      </p>
                    )}
                    {status === "Pending" && canManage && (
                      <div className="booking-actions">
                        <Button
                          size="small"
                          onClick={() => {
                            setRevoking(offer);
                            setRevokeOpen(true);
                          }}
                        >
                          Revoke offer
                        </Button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {offers.isSuccess && (
          <ListPagination
            page={rows.page}
            total={visible.length}
            onChange={setPage}
            label="Assignment offers"
          />
        )}
      </Panel>
      {revoking && (
        <RevokeOffer
          key={revoking.id}
          offer={revoking}
          open={revokeOpen}
          onClose={() => setRevokeOpen(false)}
        />
      )}
    </>
  );
}

function RevokeOffer({
  offer,
  open,
  onClose,
}: {
  offer: AssignmentOffer;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const requestKey = useRef(crypto.randomUUID());
  const revoke = useMutation({
    mutationFn: () =>
      post<AssignmentOffer>(`/api/assignment-offers/${offer.id}/revoke`, {
        expectedVersion: offer.version,
        idempotencyKey: requestKey.current,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["assignment-offers"] });
      onClose();
    },
    onError: () => {
      void qc.invalidateQueries({ queryKey: ["assignment-offers"] });
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        if (!data.open && !revoke.isPending) onClose();
      }}
    >
      <DialogSurface className="modal" aria-labelledby="revoke-offer-title">
        <h2 id="revoke-offer-title">Revoke assignment offer</h2>
        <p>
          {offer.workOrderNumber} · {offer.technicianId}. The technician will no
          longer be able to accept this offer.
        </p>
        <form
          className="editor-form"
          onSubmit={(e) => {
            e.preventDefault();
            revoke.mutate();
          }}
        >
          <Field label="Reason for revoking" required>
            <Input
              name="reason-for-revoking"
              autoComplete="off"
              required
              minLength={3}
              maxLength={500}
              value={reason}
              disabled={revoke.isPending}
              onChange={(e) => {
                setReason(e.target.value);
                requestKey.current = crypto.randomUUID();
                revoke.reset();
              }}
            />
          </Field>
          {revoke.isError && (
            <InlineMessage>
              {revoke.error.message} Close this dialog and refresh offers before
              trying again if the offer changed.
            </InlineMessage>
          )}
          <div className="form-actions">
            <Button type="button" disabled={revoke.isPending} onClick={onClose}>
              Keep offer
            </Button>
            <Button
              appearance="primary"
              type="submit"
              disabled={revoke.isPending || reason.trim().length < 3}
            >
              {revoke.isPending ? "Revoking…" : "Confirm revocation"}
            </Button>
          </div>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Button,
  Dialog,
  DialogSurface,
  Field,
  Input,
  Select,
} from "@fluentui/react-components";
import { ClipboardCheck, RefreshCw } from "lucide-react";
import { api, post } from "../api";
import { useAuth } from "../auth";
import { dateTime } from "../format";
import type { ServiceRequest } from "../service-request-contracts";
import {
  Empty,
  ErrorState,
  InlineMessage,
  Loading,
  PageHeader,
  Panel,
  Status,
} from "../components/common";

export function ServiceRequests() {
  const auth = useAuth();
  const [selected, setSelected] = useState<ServiceRequest | null>(null);
  const [status, setStatus] = useState("Submitted");
  const requests = useQuery({
    queryKey: ["service-requests"],
    queryFn: () => api<ServiceRequest[]>("/api/service-requests"),
    refetchInterval: 15000,
  });
  const visible = (requests.data ?? []).filter(
    (request) => !status || request.status === status,
  );
  return (
    <>
      <PageHeader
        eyebrow="CUSTOMER INTAKE"
        title="Service requests"
        description="Qualify customer requests into work orders, then confirm capacity through dispatch."
        actions={
          <Button
            icon={<RefreshCw size={16} />}
            disabled={requests.isFetching}
            onClick={() => void requests.refetch()}
          >
            Refresh requests
          </Button>
        }
      />
      <Panel
        title="Request queue"
        description="An approved request creates a work order. Appointments are confirmed separately."
      >
        <div className="offer-toolbar">
          <Field label="Request status">
            <Select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="Submitted">Awaiting qualification</option>
              <option value="Qualified">Qualified</option>
              <option value="Rejected">Rejected</option>
              <option value="">All requests</option>
            </Select>
          </Field>
          <span className="count-pill">
            {requests.data?.filter((request) => request.status === "Submitted")
              .length ?? 0}{" "}
            awaiting review
          </span>
          <span className="muted">Refreshes every 15 seconds</span>
        </div>
        {requests.isPending ? (
          <Loading />
        ) : requests.isError ? (
          <ErrorState
            error={requests.error}
            retry={() => void requests.refetch()}
          />
        ) : visible.length === 0 ? (
          <Empty
            title="No requests in this queue"
            description="Customer submissions will appear here for qualification."
          />
        ) : (
          <div className="portal-records portal-record-grid">
            {visible.map((request) => (
              <article key={request.id} className="portal-record">
                <div className="portal-record-heading">
                  <h3>{request.title}</h3>
                  <Status value={request.status} />
                </div>
                <p>
                  <strong>{request.customerName}</strong> ·{" "}
                  {request.siteAddress}
                </p>
                <p>
                  {request.serviceType} · <Status value={request.urgency} /> ·
                  Submitted {dateTime(request.createdAtUtc)}
                </p>
                <p className="portal-notes">{request.description}</p>
                {request.assetId && (
                  <p>Registered equipment: {request.assetId}</p>
                )}
                {request.decisionReason && (
                  <p>Decision: {request.decisionReason}</p>
                )}
                {request.status === "Submitted" &&
                  auth.can("Dispatcher", "Supervisor", "OperationsManager") && (
                    <Button
                      icon={<ClipboardCheck size={16} />}
                      appearance="primary"
                      onClick={() => setSelected(request)}
                    >
                      Review request
                    </Button>
                  )}
                {request.workOrderId && (
                  <div className="booking-actions">
                    <Link to={`/work-orders/${request.workOrderId}`}>
                      View work order
                    </Link>
                    <Link to={`/schedule?workOrderId=${request.workOrderId}`}>
                      Schedule service
                    </Link>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </Panel>
      {selected && (
        <Qualification request={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}

function Qualification({
  request,
  onClose,
}: {
  request: ServiceRequest;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [decision, setDecision] = useState("Approve");
  const [serviceCategory, setCategory] = useState("HVAC");
  const [priority, setPriority] = useState(
    request.urgency === "Emergency"
      ? "Critical"
      : request.urgency === "Urgent"
        ? "High"
        : "Normal",
  );
  const [reason, setReason] = useState("");
  const qualify = useMutation({
    mutationFn: () =>
      post<ServiceRequest>(`/api/service-requests/${request.id}/qualify`, {
        expectedVersion: request.version,
        decision,
        reason: reason.trim(),
        serviceCategory,
        priority,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["service-requests"] });
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      onClose();
    },
    onError: () => {
      void qc.invalidateQueries({ queryKey: ["service-requests"] });
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(_, data) => {
        if (!data.open && !qualify.isPending) onClose();
      }}
    >
      <DialogSurface className="modal" aria-labelledby="qualify-title">
        <span className="eyebrow">AUDITED REQUEST DECISION</span>
        <h2 id="qualify-title">Qualify service request</h2>
        <p>
          <strong>{request.title}</strong> · {request.customerName}
        </p>
        <p className="portal-notes">{request.description}</p>
        <form
          className="editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            qualify.mutate();
          }}
        >
          <Field label="Decision">
            <Select
              value={decision}
              disabled={qualify.isPending}
              onChange={(event) => {
                setDecision(event.target.value);
                qualify.reset();
              }}
            >
              <option value="Approve">Approve and create work order</option>
              <option value="Reject">Reject with a reason</option>
            </Select>
          </Field>
          {decision === "Approve" && (
            <>
              <Field label="Required service skill">
                <Select
                  value={serviceCategory}
                  disabled={qualify.isPending}
                  onChange={(event) => setCategory(event.target.value)}
                >
                  {[
                    "HVAC",
                    "Electrical",
                    "Refrigeration",
                    "Controls",
                    "Mechanical",
                  ].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Work order priority">
                <Select
                  value={priority}
                  disabled={qualify.isPending}
                  onChange={(event) => setPriority(event.target.value)}
                >
                  {["Low", "Normal", "High", "Critical"].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </Field>
              <p className="muted">
                This creates an unassigned work order. Contract and warranty
                coverage require separate review; appointment capacity is
                checked during scheduling.
              </p>
            </>
          )}
          <Field label="Decision reason" required>
            <Input
              required
              minLength={3}
              maxLength={500}
              value={reason}
              disabled={qualify.isPending}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Explain the qualification or rejection"
            />
          </Field>
          {qualify.isError && (
            <InlineMessage>
              {qualify.error.message} Close this dialog and refresh the request
              if another dispatcher has reviewed it.
            </InlineMessage>
          )}
          <div className="form-actions">
            <Button
              type="button"
              disabled={qualify.isPending}
              onClick={onClose}
            >
              Keep request open
            </Button>
            <Button
              appearance="primary"
              type="submit"
              disabled={qualify.isPending || reason.trim().length < 3}
            >
              {qualify.isPending
                ? "Recording decision…"
                : decision === "Approve"
                  ? "Create work order"
                  : "Confirm rejection"}
            </Button>
          </div>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

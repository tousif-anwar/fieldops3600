import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Field,
  Input,
  Select,
  Textarea,
} from "@fluentui/react-components";
import {
  CalendarDays,
  ClipboardList,
  MapPin,
  RefreshCw,
  Wrench,
} from "lucide-react";
import { api, post } from "../api";
import { dateTime } from "../format";
import { locationAddress } from "../customer-contracts";
import type {
  PortalAccount,
  PortalEquipment,
  PortalWorkOrder,
  ServiceRequest,
} from "../service-request-contracts";
import type { Booking } from "../types";
import {
  Empty,
  ErrorState,
  InlineMessage,
  Loading,
  PageHeader,
  Panel,
  Status,
} from "../components/common";
import { ServiceReport } from "../components/ServiceReport";

export function CustomerPortal() {
  const qc = useQueryClient();
  const account = useQuery({
    queryKey: ["portal-account"],
    queryFn: () => api<PortalAccount>("/api/customer-portal/account"),
  });
  const equipment = useQuery({
    queryKey: ["portal-equipment"],
    queryFn: () => api<PortalEquipment[]>("/api/customer-portal/equipment"),
  });
  const requests = useQuery({
    queryKey: ["service-requests"],
    queryFn: () => api<ServiceRequest[]>("/api/service-requests"),
    refetchInterval: 15000,
  });
  const orders = useQuery({
    queryKey: ["portal-work-orders"],
    queryFn: () => api<PortalWorkOrder[]>("/api/customer-portal/work-orders"),
    refetchInterval: 15000,
  });
  const bookings = useQuery({
    queryKey: ["portal-appointments"],
    queryFn: () => api<Booking[]>("/api/customer-portal/appointments"),
    refetchInterval: 15000,
  });
  const [serviceLocationId, setLocation] = useState("");
  const [assetId, setAsset] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [serviceType, setServiceType] =
    useState<ServiceRequest["serviceType"]>("Repair");
  const [urgency, setUrgency] = useState<ServiceRequest["urgency"]>("Routine");
  const [reportOrderId, setReportOrderId] = useState<string | null>(null);
  const requestKey = useRef(crypto.randomUUID());
  const submit = useMutation({
    mutationFn: () =>
      post<ServiceRequest>("/api/service-requests", {
        serviceLocationId,
        assetId: assetId || null,
        title: title.trim(),
        description: description.trim(),
        serviceType,
        urgency,
        idempotencyKey: requestKey.current,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["service-requests"] });
      requestKey.current = crypto.randomUUID();
      setTitle("");
      setDescription("");
    },
  });
  function change() {
    requestKey.current = crypto.randomUUID();
    submit.reset();
  }
  const refresh = () => {
    void account.refetch();
    void equipment.refetch();
    void requests.refetch();
    void orders.refetch();
    void bookings.refetch();
  };
  const locations =
    account.data?.locations.filter(
      (location) => location.status === "Active",
    ) ?? [];
  const atLocation =
    equipment.data?.filter(
      (asset) =>
        asset.serviceLocationId === serviceLocationId &&
        asset.status === "Active",
    ) ?? [];
  const confirmed = (bookings.data ?? [])
    .filter((booking) => booking.status === "Confirmed")
    .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
  if (account.isPending)
    return <Loading label="Loading your service account…" />;
  if (account.isError)
    return (
      <ErrorState error={account.error} retry={() => void account.refetch()} />
    );
  return (
    <>
      <PageHeader
        eyebrow="CUSTOMER SERVICE"
        title={account.data?.displayName ?? "Customer portal"}
        description="Request service and follow your confirmed appointments and service history."
        actions={
          <Button icon={<RefreshCw size={16} />} onClick={refresh}>
            Refresh your service
          </Button>
        }
      />
      <div className="portal-layout">
        <Panel
          title="Request service"
          description="Dispatch reviews your request before scheduling. Submitting does not reserve an appointment."
        >
          <form
            className="form-body"
            onSubmit={(event) => {
              event.preventDefault();
              submit.mutate();
            }}
          >
            <Field label="Service location" required>
              <Select
                required
                value={serviceLocationId}
                disabled={submit.isPending || account.data?.status !== "Active"}
                onChange={(event) => {
                  setLocation(event.target.value);
                  setAsset("");
                  change();
                }}
              >
                <option value="">Choose one of your locations</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name} — {locationAddress(location)}
                  </option>
                ))}
              </Select>
            </Field>
            {locations.length === 0 && (
              <InlineMessage>
                No active service location is registered. Contact the service
                team to update your account.
              </InlineMessage>
            )}
            <Field
              label="Equipment"
              hint="Choose registered equipment, or describe the unit in your request."
            >
              <Select
                value={assetId}
                disabled={
                  !serviceLocationId ||
                  submit.isPending ||
                  equipment.isPending ||
                  equipment.isError
                }
                onChange={(event) => {
                  setAsset(event.target.value);
                  change();
                }}
              >
                <option value="">
                  Equipment not listed / new installation
                </option>
                {atLocation.map((asset) => (
                  <option value={asset.id} key={asset.id}>
                    {asset.name} · {asset.model} · {asset.serialNumber}
                  </option>
                ))}
              </Select>
            </Field>
            {equipment.isError && (
              <ErrorState
                error={equipment.error}
                retry={() => void equipment.refetch()}
              />
            )}
            <div className="form-two">
              <Field label="Service type">
                <Select
                  value={serviceType}
                  disabled={submit.isPending}
                  onChange={(event) => {
                    setServiceType(
                      event.target.value as ServiceRequest["serviceType"],
                    );
                    change();
                  }}
                >
                  {[
                    "Repair",
                    "Maintenance",
                    "Installation",
                    "Replacement",
                    "Warranty",
                    "Diagnostic",
                  ].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Urgency">
                <Select
                  value={urgency}
                  disabled={submit.isPending}
                  onChange={(event) => {
                    setUrgency(event.target.value as ServiceRequest["urgency"]);
                    change();
                  }}
                >
                  {["Routine", "Urgent", "Emergency"].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {urgency === "Emergency" && (
              <InlineMessage>
                Emergency requests need dispatcher review. Submission does not
                confirm a response time. Use your service company’s emergency
                contact for immediate assistance.
              </InlineMessage>
            )}
            <Field label="Request title" required>
              <Input
                required
                minLength={5}
                maxLength={160}
                value={title}
                disabled={submit.isPending}
                onChange={(event) => {
                  setTitle(event.target.value);
                  change();
                }}
                placeholder="For example, upstairs unit is not cooling"
              />
            </Field>
            <Field
              label="Describe the problem"
              required
              hint="Include symptoms, access requirements, and when the issue started."
            >
              <Textarea
                required
                minLength={10}
                maxLength={4000}
                rows={5}
                value={description}
                disabled={submit.isPending}
                onChange={(event) => {
                  setDescription(event.target.value);
                  change();
                }}
              />
            </Field>
            {submit.isError && (
              <InlineMessage>
                {submit.error.message} Your request details are preserved. Retry
                without changing the form if the response was lost.
              </InlineMessage>
            )}
            {submit.isSuccess && (
              <InlineMessage success>
                Service request received for review. Your appointment will
                appear here once scheduling is confirmed.
              </InlineMessage>
            )}
            <Button
              appearance="primary"
              type="submit"
              icon={<ClipboardList size={16} />}
              disabled={
                submit.isPending ||
                !serviceLocationId ||
                title.trim().length < 5 ||
                description.trim().length < 10 ||
                account.data?.status !== "Active"
              }
            >
              {submit.isPending
                ? "Submitting request…"
                : "Submit service request"}
            </Button>
          </form>
        </Panel>
        <div className="portal-side">
          <Panel
            title="Your appointments"
            description="Confirmed scheduling records. Times use your device’s local time."
          >
            {bookings.isPending ? (
              <Loading />
            ) : bookings.isError ? (
              <ErrorState
                error={bookings.error}
                retry={() => void bookings.refetch()}
              />
            ) : confirmed.length === 0 ? (
              <Empty
                title="No confirmed appointment"
                description="A request or assignment offer becomes an appointment only when scheduling is committed."
              />
            ) : (
              <div className="portal-records">
                {confirmed.map((booking) => {
                  const order = orders.data?.find(
                    (item) => item.id === booking.workOrderId,
                  );
                  return (
                    <article className="portal-record" key={booking.id}>
                      <strong>
                        <CalendarDays size={16} /> {dateTime(booking.startUtc)}
                      </strong>
                      <p>Until {dateTime(booking.endUtc)}</p>
                      <h3>{order?.title ?? "Service appointment"}</h3>
                      <p>
                        <MapPin size={14} />{" "}
                        {order?.siteAddress ??
                          "Your registered service location"}
                      </p>
                      <Status
                        value={
                          order?.status === "Completed"
                            ? "Completed"
                            : "Confirmed"
                        }
                      />
                    </article>
                  );
                })}
              </div>
            )}
          </Panel>
          <Panel
            title="Registered equipment"
            description="Equipment registered to your authorized service account."
          >
            {equipment.isPending ? (
              <Loading />
            ) : equipment.isError ? (
              <ErrorState
                error={equipment.error}
                retry={() => void equipment.refetch()}
              />
            ) : !equipment.data?.length ? (
              <Empty
                title="No equipment registered"
                description="You can still request service and describe your equipment."
              />
            ) : (
              <div className="portal-records">
                {equipment.data.map((asset) => (
                  <article className="portal-record" key={asset.id}>
                    <strong>
                      <Wrench size={16} /> {asset.name}
                    </strong>
                    <p>
                      {asset.manufacturer} · {asset.model}
                    </p>
                    <small>Serial {asset.serialNumber}</small>
                    <p>
                      {account.data?.locations.find(
                        (location) => location.id === asset.serviceLocationId,
                      )?.name ?? "Registered location"}
                    </p>
                    <Status value={asset.status} />
                  </article>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
      <Panel
        title="Your service requests"
        description="Request decisions and linked work order progress refresh every 15 seconds."
      >
        {requests.isPending ? (
          <Loading />
        ) : requests.isError ? (
          <ErrorState
            error={requests.error}
            retry={() => void requests.refetch()}
          />
        ) : !requests.data?.length ? (
          <Empty
            title="No service request yet"
            description="Submit your first request using the form above."
          />
        ) : (
          <div className="portal-records portal-record-grid">
            {requests.data.map((request) => {
              const order = orders.data?.find(
                (item) => item.id === request.workOrderId,
              );
              return (
                <article className="portal-record" key={request.id}>
                  <div className="portal-record-heading">
                    <h3>{request.title}</h3>
                    <Status value={request.status} />
                  </div>
                  <p>
                    {request.serviceType} · {request.urgency} ·{" "}
                    {dateTime(request.createdAtUtc)}
                  </p>
                  <p>{request.siteAddress}</p>
                  <p className="portal-notes">{request.description}</p>
                  {request.status === "Submitted" && (
                    <p>
                      Awaiting service team review. An appointment has not been
                      confirmed.
                    </p>
                  )}
                  {request.decisionReason && (
                    <p>Service team: {request.decisionReason}</p>
                  )}
                  {order && (
                    <p>
                      {order.number} · <Status value={order.status} />
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </Panel>
      <div className="dispatch-offers-section">
        <Panel
          title="Service history"
          description="Work orders and completed service reports for your account."
        >
          {orders.isPending ? (
            <Loading />
          ) : orders.isError ? (
            <ErrorState
              error={orders.error}
              retry={() => void orders.refetch()}
            />
          ) : !orders.data?.length ? (
            <Empty
              title="No service history"
              description="A work order appears after your request is qualified."
            />
          ) : (
            <div className="portal-records portal-record-grid">
              {orders.data.map((order) => (
                <article key={order.id} className="portal-record">
                  <div className="portal-record-heading">
                    <strong>{order.number}</strong>
                    <Status value={order.status} />
                  </div>
                  <h3>{order.title}</h3>
                  <p>{order.siteAddress}</p>
                  <p>
                    {order.completedAtUtc
                      ? `Completed ${dateTime(order.completedAtUtc)}`
                      : `Created ${dateTime(order.createdAtUtc)}`}
                  </p>
                  {order.status === "Completed" && (
                    <Button onClick={() => setReportOrderId(order.id)}>
                      View service report
                    </Button>
                  )}
                </article>
              ))}
            </div>
          )}
        </Panel>
      </div>
      {reportOrderId && (
        <ServiceReport
          workOrderId={reportOrderId}
          onClose={() => setReportOrderId(null)}
        />
      )}
    </>
  );
}

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Button,
  useRestoreFocusTarget,
  Checkbox,
  Field,
  Input,
  Select,
  Textarea,
} from "@fluentui/react-components";
import {
  ArrowLeft,
  ArrowRight,
  CalendarPlus,
  History,
  MapPin,
  Plus,
  Search,
  Wrench,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
  Status,
} from "../components/common";
import type { WorkOrder, Workflow } from "../types";
import { OrderEditor } from "../components/OrderEditor";
import { CustomerServiceDetails } from "../components/CustomerServiceDetails";
import {
  locationAddress,
  type Customer,
  type Page,
} from "../customer-contracts";
import {
  assetIdentity,
  warrantyLabel,
  type Asset,
  type AssetSummary,
} from "../asset-contracts";

export function WorkOrders() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [priority, setPriority] = useState(params.get("priority") ?? "");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  useEffect(() => {
    setSearch(params.get("q") ?? "");
    setStatus(params.get("status") ?? "");
    setPriority(params.get("priority") ?? "");
  }, [params]);
  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const clearFilters = () => {
    setSearch("");
    setStatus("");
    setPriority("");
    setParams({}, { replace: true });
  };
  const orders = useQuery({
    queryKey: ["work-orders"],
    queryFn: () => api<WorkOrder[]>("/api/work-orders"),
  });
  const filtered = (orders.data ?? []).filter(
    (w) =>
      `${w.number} ${w.title} ${w.customerName} ${w.siteAddress}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!status || w.status === status) &&
      (!priority || w.priority === priority),
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    setPage(1);
  }, [search, status, priority]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  return (
    <>
      <PageHeader
        title="Work orders"
        actions={
          auth.can("Dispatcher", "OperationsManager") && (
            <Link to={"/work-orders/new"} className="button-link primary">
              <Plus aria-hidden="true" size={17} />
              Create work order
            </Link>
          )
        }
      />
      <Panel
        description={`${filtered.length} ${filtered.length === 1 ? "request" : "requests"} in your authorized scope`}
      >
        <div className="filter-bar">
          <Input
            name="filter-work-orders"
            autoComplete="off"
            className="search-field"
            contentBefore={<Search size={17} aria-hidden="true" />}
            aria-label="Filter work orders"
            placeholder="Search number, customer, or address…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              updateFilter("q", e.target.value);
            }}
          />
          <Select
            name="filter-status"
            aria-label="Filter status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              updateFilter("status", e.target.value);
            }}
          >
            <option value="">All statuses</option>
            {[...new Set((orders.data ?? []).map((o) => o.status))].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </Select>
          <Select
            name="filter-priority"
            aria-label="Filter priority"
            value={priority}
            onChange={(e) => {
              setPriority(e.target.value);
              updateFilter("priority", e.target.value);
            }}
          >
            <option value="">All priorities</option>
            {["Low", "Normal", "High", "Critical"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </Select>
          {(search || status || priority) && (
            <Button appearance="subtle" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>
        {orders.isPending ? (
          <Loading />
        ) : orders.isError ? (
          <ErrorState
            error={orders.error}
            retry={() => void orders.refetch()}
          />
        ) : filtered.length === 0 ? (
          <Empty
            title={
              search || status || priority
                ? "No matching work orders"
                : "No service requests yet"
            }
            description={
              search || status || priority
                ? "Try a different search or clear your filters."
                : "Create a work order to start the service lifecycle."
            }
          />
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-label="All work orders"
            className="table-scroll"
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Work order</th>
                  <th scope="col">Customer & location</th>
                  <th scope="col">Service category</th>
                  <th scope="col">Priority</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <Link
                        className="table-main-link"
                        to={`/work-orders/${w.id}`}
                      >
                        {w.number}
                      </Link>
                      <small className="table-subline">{w.title}</small>
                    </td>
                    <td>
                      {w.customerName}
                      <small className="table-subline">{w.siteAddress}</small>
                    </td>
                    <td>{w.serviceCategory}</td>
                    <td>
                      <Status value={w.priority} />
                    </td>
                    <td>
                      <Status value={w.status} />
                    </td>
                    <td className="nowrap">{dateTime(w.createdAtUtc)}</td>
                    <td>
                      <Button
                        appearance="subtle"
                        icon={<ArrowRight aria-hidden="true" size={16} />}
                        aria-label={`Open ${w.number}`}
                        onClick={() => navigate(`/work-orders/${w.id}`)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > pageSize && (
              <div className="table-pagination">
                <span>
                  Showing {(page - 1) * pageSize + 1}–
                  {Math.min(page * pageSize, filtered.length)} of{" "}
                  {filtered.length}
                </span>
                <div>
                  <Button
                    appearance="subtle"
                    disabled={page === 1}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                  >
                    Previous
                  </Button>
                  <span>
                    Page {page} of {pageCount}
                  </span>
                  <Button
                    appearance="subtle"
                    disabled={page === pageCount}
                    onClick={() =>
                      setPage((value) => Math.min(pageCount, value + 1))
                    }
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Panel>
    </>
  );
}
const orderSchema = z.object({
  title: z
    .string()
    .trim()
    .min(5, "Add a title with at least five characters.")
    .max(160),
  customerName: z.string().trim().min(2, "Customer name is required.").max(100),
  siteAddress: z
    .string()
    .trim()
    .min(5, "Enter the full service address.")
    .max(240),
  serviceCategory: z.string().min(1, "Choose a service category."),
  priority: z.enum(["Low", "Normal", "High", "Critical"]),
  teamId: z.string().min(1),
});
type OrderInput = z.infer<typeof orderSchema>;
export function CreateOrder() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const auth = useAuth();
  const [customerId, setCustomerId] = useState(params.get("customerId") ?? "");
  const [locationId, setLocationId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [assetId, setAssetId] = useState("");
  const [unregistered, setUnregistered] = useState(false);
  const [exceptionReason, setExceptionReason] = useState("");
  const [referenceError, setReferenceError] = useState("");
  const customers = useQuery({
    queryKey: ["customers", "lookup", customerSearch],
    queryFn: () =>
      api<Page<Customer>>(
        `/api/customers?${new URLSearchParams({ search: customerSearch, status: "Active", page: "1", pageSize: "25", sort: "name" })}`,
      ),
    enabled: !unregistered,
  });
  const selectedCustomer = useQuery({
    queryKey: ["customer", customerId],
    queryFn: () => api<Customer>(`/api/customers/${customerId}`),
    enabled: !!customerId && !unregistered,
  });
  const assets = useQuery({
    queryKey: ["assets", "new-order", customerId, locationId],
    queryFn: () =>
      api<Page<AssetSummary>>(
        `/api/assets?${new URLSearchParams({ customerId, serviceLocationId: locationId, status: "Active", page: "1", pageSize: "100", sort: "name" })}`,
      ),
    enabled: !unregistered && !!customerId && !!locationId,
  });
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<OrderInput>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      title: "",
      customerName: "",
      siteAddress: "",
      serviceCategory: "HVAC",
      priority: "Normal",
      teamId: String(
        auth.user?.profile.team_id ?? auth.user?.profile.teamId ?? "north",
      ),
    },
  });
  useEffect(() => {
    if (unregistered || !selectedCustomer.data) return;
    setValue("customerName", selectedCustomer.data.displayName);
    const location = selectedCustomer.data.locations.find(
      (l) => l.id === locationId,
    );
    setValue("siteAddress", location ? locationAddress(location) : "");
  }, [selectedCustomer.data, locationId, setValue, unregistered]);
  const mutation = useMutation({
    throwOnError: false,
    mutationFn: (body: OrderInput) =>
      post<WorkOrder>("/api/work-orders", {
        ...body,
        customerId: unregistered ? null : customerId,
        serviceLocationId: unregistered ? null : locationId,
        assetId: unregistered ? null : assetId || null,
        unregisteredCustomerReason: unregistered
          ? exceptionReason.trim()
          : null,
      }),
    onSuccess: (order) => {
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      navigate(`/work-orders/${order.id}`);
    },
  });
  if (!auth.can("Dispatcher", "OperationsManager"))
    return (
      <ErrorState
        error={new Error("Your role cannot create service requests.")}
      />
    );
  return (
    <>
      <Link to={"/work-orders"} className="back-link">
        <ArrowLeft aria-hidden="true" size={15} />
        Work orders
      </Link>
      <PageHeader title="Create a work order" />
      <Panel title="Service details">
        <form
          className="form-body"
          noValidate
          onSubmit={handleSubmit((v) => {
            if (
              !unregistered &&
              (!customerId || !locationId || !selectedCustomer.data)
            ) {
              setReferenceError(
                "Select a registered customer and an active service location.",
              );
              return;
            }
            if (unregistered && exceptionReason.trim().length < 8) {
              setReferenceError(
                "Explain the unregistered customer exception using at least eight characters.",
              );
              return;
            }
            setReferenceError("");
            mutation.mutate(v);
          })}
        >
          {" "}
          <Checkbox
            label="Use an unregistered customer exception"
            checked={unregistered}
            onChange={(_, d) => {
              setUnregistered(d.checked === true);
              setAssetId("");
              setReferenceError("");
            }}
          />
          {!unregistered && (
            <>
              <Field label="Search registered customers">
                <Input
                  name="search-registered-customers"
                  autoComplete="off"
                  value={customerSearch}
                  onChange={(_, d) => setCustomerSearch(d.value)}
                  placeholder="Search the customer registry…"
                />
              </Field>
              {customers.isPending ? (
                <Loading label="Loading customers…" />
              ) : customers.isError ? (
                <ErrorState
                  error={customers.error}
                  retry={() => void customers.refetch()}
                />
              ) : (
                <Field label="Registered customer" required>
                  {" "}
                  <Select
                    name="registered-customer"
                    value={customerId}
                    onChange={(e) => {
                      setCustomerId(e.target.value);
                      setLocationId("");
                      setAssetId("");
                      setValue("customerName", "");
                      setValue("siteAddress", "");
                    }}
                  >
                    <option value="">Choose a customer</option>
                    {selectedCustomer.data &&
                      !customers.data.items.some(
                        (c) => c.id === customerId,
                      ) && (
                        <option value={selectedCustomer.data.id}>
                          {selectedCustomer.data.displayName}
                        </option>
                      )}
                    {customers.data.items.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.displayName}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {selectedCustomer.isError && (
                <ErrorState
                  error={selectedCustomer.error}
                  retry={() => void selectedCustomer.refetch()}
                />
              )}
              <Field label="Registered service location" required>
                <Select
                  name="registered-service-location"
                  value={locationId}
                  disabled={
                    !selectedCustomer.data || selectedCustomer.isPending
                  }
                  onChange={(e) => {
                    setLocationId(e.target.value);
                    setAssetId("");
                  }}
                >
                  <option value="">Choose a service location</option>
                  {selectedCustomer.data?.locations
                    .filter((l) => l.status === "Active")
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} — {locationAddress(l)}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field
                label="Equipment"
                hint="Optional: link one active registered asset at this location."
              >
                <Select
                  name="equipment"
                  value={assetId}
                  disabled={!locationId || assets.isPending}
                  onChange={(e) => setAssetId(e.target.value)}
                >
                  <option value="">No specific equipment</option>
                  {assets.data?.items
                    .filter((a) => a.serviceLocationId === locationId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} — Serial {a.serialNumber}
                      </option>
                    ))}
                </Select>
                {assets.isError && (
                  <InlineMessage>{assets.error.message}</InlineMessage>
                )}
              </Field>
              <Link to="/customers/new">Register a customer and location</Link>
            </>
          )}
          {unregistered && (
            <Field
              label="Unregistered customer reason"
              required
              hint="This exception is retained in the work order audit history."
            >
              <Textarea
                name="unregistered-customer-reason"
                autoComplete="off"
                value={exceptionReason}
                maxLength={500}
                onChange={(_, d) => setExceptionReason(d.value)}
              />
            </Field>
          )}
          <Field
            label="Work order title"
            required
            validationState={errors.title ? "error" : "none"}
            validationMessage={errors.title?.message}
          >
            <Input
              autoComplete="off"
              placeholder="e.g. Rooftop unit not cooling"
              {...register("title")}
            />
          </Field>
          <div className="form-two">
            <Field
              label="Customer name"
              required
              validationState={errors.customerName ? "error" : "none"}
              validationMessage={errors.customerName?.message}
            >
              <Input
                autoComplete="off"
                placeholder="Business or customer name"
                readOnly={!unregistered}
                {...register("customerName")}
              />
            </Field>
            <Field label="Service category" required>
              <Select {...register("serviceCategory")}>
                <option>HVAC</option>
                <option>Electrical</option>
                <option>Refrigeration</option>
                <option>Controls</option>
                <option>Mechanical</option>
                <option>Heating</option>
                <option>Cooling</option>
                <option>Ventilation</option>
              </Select>
            </Field>
          </div>
          <Field
            label="Service address"
            required
            validationState={errors.siteAddress ? "error" : "none"}
            validationMessage={errors.siteAddress?.message}
          >
            <Textarea
              autoComplete="off"
              placeholder="Street address, city, and access details"
              readOnly={!unregistered}
              {...register("siteAddress")}
            />
          </Field>
          <div className="form-two">
            <Field label="Priority" required>
              <Select {...register("priority")}>
                {["Low", "Normal", "High", "Critical"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </Select>
            </Field>
            <Field
              label="Team"
              hint="Assignment scope from your authenticated account"
            >
              <Input autoComplete="off" readOnly {...register("teamId")} />
            </Field>
          </div>
          {mutation.isError && (
            <InlineMessage>{mutation.error.message}</InlineMessage>
          )}
          {referenceError && <InlineMessage>{referenceError}</InlineMessage>}
          <div className="form-actions">
            <Button onClick={() => navigate("/work-orders")}>Cancel</Button>
            <Button
              appearance="primary"
              type="submit"
              disabled={mutation.isPending}
              icon={<Plus aria-hidden="true" size={16} />}
            >
              {mutation.isPending ? "Creating…" : "Create work order"}
            </Button>
          </div>
        </form>
      </Panel>
    </>
  );
}
export function OrderDetails() {
  const [editing, setEditing] = useState(false);
  const [editingOrder, setEditingOrder] = useState<WorkOrder | null>(null);
  const restoreFocusTarget = useRestoreFocusTarget();
  const { id } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const qc = useQueryClient();
  const order = useQuery({
    queryKey: ["work-order", id],
    queryFn: () => api<WorkOrder>(`/api/work-orders/${id}`),
    enabled: !!id,
  });
  const workflows = useQuery({
    queryKey: ["workflows", id],
    queryFn: () =>
      api<Workflow[]>(`/api/workflows?workOrderId=${encodeURIComponent(id!)}`),
    enabled: !!id,
  });
  const linkedAsset = useQuery({
    queryKey: ["asset", order.data?.assetId],
    queryFn: () => api<Asset>(`/api/assets/${order.data!.assetId}`),
    enabled: !!order.data?.assetId,
  });
  const start = useMutation({
    mutationFn: () => post<Workflow>("/api/workflows", { workOrderId: id }),
    onSuccess: (f) => {
      void qc.invalidateQueries({ queryKey: ["workflows"] });
      navigate(`/workflow/${f.id}`);
    },
  });
  if (order.isPending) return <Loading />;
  if (order.isError)
    return (
      <ErrorState error={order.error} retry={() => void order.refetch()} />
    );
  const w = order.data;
  return (
    <>
      <Link to={"/work-orders"} className="back-link">
        <ArrowLeft aria-hidden="true" size={15} />
        Work orders
      </Link>
      <PageHeader
        eyebrow={w.number}
        title={w.title}
        description={`${w.customerName} · ${w.serviceCategory}`}
        actions={
          <>
            <Status value={w.status} />
            {auth.can("Dispatcher", "OperationsManager") && (
              <Button {...restoreFocusTarget} onClick={() => {setEditingOrder(w); setEditing(true);}}>Edit request</Button>
            )}
          </>
        }
      />
      <div className="detail-grid">
        <Panel
          title="Service request"
          description={`Created ${dateTime(w.createdAtUtc)}`}
        >
          <dl className="detail-list">
            <div>
              <dt>Reported problem</dt>
              <dd className="portal-notes">
                {w.reportedProblem?.trim() ? w.reportedProblem : w.title}
              </dd>
            </div>
            <div>
              <dt>Customer</dt>
              <dd>{w.customerName}</dd>
            </div>
            <div>
              <dt>Service address</dt>
              <dd>
                <MapPin aria-hidden="true" size={15} />
                {w.siteAddress}
              </dd>
            </div>
            <div>
              <dt>Service category</dt>
              <dd>{w.serviceCategory}</dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>
                <Status value={w.priority} />
              </dd>
            </div>
            <div>
              <dt>Assigned technician</dt>
              <dd>{w.technicianId ?? "Awaiting dispatch"}</dd>
            </div>
            <div>
              <dt>Team</dt>
              <dd>{w.teamId}</dd>
            </div>
            <div>
              <dt>Record version</dt>
              <dd>{w.version}</dd>
            </div>
          </dl>
        </Panel>
        <Panel title="Actions">
          <div className="detail-actions">
            {auth.can("Dispatcher", "OperationsManager") && (
              <Link
                to={`/schedule?workOrderId=${w.id}`}
                className="button-link"
              >
                <CalendarPlus aria-hidden="true" size={17} />
                Schedule service
              </Link>
            )}
            {workflows.data?.map((f) => (
              <Link
                to={`/workflow/${f.id}`}
                className="button-link primary"
                key={f.id}
              >
                <Wrench aria-hidden="true" size={17} />
                {f.status === "Completed"
                  ? "Review completed workflow"
                  : "Continue workflow"}
              </Link>
            ))}
            {!workflows.isPending &&
              !workflows.data?.length &&
              w.technicianId &&
              auth.can(
                "Technician",
                "Supervisor",
                "Dispatcher",
                "OperationsManager",
              ) && (
                <Button
                  appearance="primary"
                  icon={<Wrench aria-hidden="true" size={17} />}
                  disabled={start.isPending}
                  onClick={() => start.mutate()}
                >
                  {start.isPending ? "Starting…" : "Start guided workflow"}
                </Button>
              )}
            {!w.technicianId && (
              <p>
                Confirm a booking to assign a technician before starting the
                service pipeline.
              </p>
            )}
            {auth.can("Supervisor", "OperationsManager") && (
              <Link to={`/replay?workOrderId=${w.id}`} className="button-link">
                <History aria-hidden="true" size={17} />
                Investigate operational history
              </Link>
            )}
            {start.isError && (
              <InlineMessage>{start.error.message}</InlineMessage>
            )}
          </div>
        </Panel>
      </div>
      <CustomerServiceDetails order={w} />
      <OrderEquipmentPanel
        order={w}
        asset={linkedAsset.data}
        loading={linkedAsset.isPending}
        error={linkedAsset.error}
        retry={() => void linkedAsset.refetch()}
      />
      <OrderEditor order={editingOrder ?? w} open={editing} onClose={() => setEditing(false)} />
    </>
  );
}

function OrderEquipmentPanel({
  order,
  asset,
  loading,
  error,
  retry,
}: {
  order: WorkOrder;
  asset?: Asset;
  loading: boolean;
  error: Error | null;
  retry: () => void;
}) {
  const auth = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [assetId, setAssetId] = useState(order.assetId ?? "");
  const available = useQuery({
    queryKey: [
      "assets",
      "order-link",
      order.customerId,
      order.serviceLocationId,
    ],
    queryFn: () =>
      api<Page<Asset>>(
        `/api/assets?${new URLSearchParams({ customerId: order.customerId!, serviceLocationId: order.serviceLocationId!, status: "Active", page: "1", pageSize: "100", sort: "name" })}`,
      ),
    enabled: editing && !!order.customerId && !!order.serviceLocationId,
  });
  const save = useMutation({
    mutationFn: () =>
      api<WorkOrder>(`/api/work-orders/${order.id}/asset`, {
        method: "PUT",
        body: JSON.stringify({
          expectedVersion: order.version,
          assetId: assetId || null,
        }),
      }),
    onSuccess: (updated) => {
      qc.setQueryData(["work-order", order.id], updated);
      void qc.invalidateQueries({ queryKey: ["asset-orders"] });
      setEditing(false);
    },
  });
  const canChange = auth.can("Dispatcher", "OperationsManager");
  return (
    <Panel
      title="Equipment"

      action={
        canChange && !editing ? (
          <Button onClick={() => setEditing(true)}>
            {order.assetId ? "Change link" : "Link equipment"}
          </Button>
        ) : undefined
      }
    >
      {order.assetId ? (
        loading ? (
          <Loading />
        ) : error ? (
          <ErrorState error={error} retry={retry} />
        ) : asset ? (
          <dl className="detail-list">
            <div>
              <dt>Asset</dt>
              <dd>
                <Link to={`/assets/${asset.id}`}>{asset.name}</Link>
              </dd>
            </div>
            <div>
              <dt>Identity</dt>
              <dd>{assetIdentity(asset)}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>
                {asset.assetType} · {asset.criticality} criticality
              </dd>
            </div>
            <div>
              <dt>Warranty</dt>
              <dd>
                {asset.warrantyEndUtc
                  ? `${asset.warrantyEndUtc.slice(0, 10)} · ${warrantyLabel(asset)}`
                  : "No warranty recorded"}
              </dd>
            </div>
          </dl>
        ) : null
      ) : (
        <p className="customer-note">
          No registered equipment is linked to this work order. Link one when
          the visit concerns a specific asset.
        </p>
      )}
      {editing && (
        <div className="form-body">
          <Field
            label="Linked equipment"
            hint="Only active equipment at this work order's customer location is selectable."
          >
            <Select
              name="linked-equipment"
              value={assetId}
              disabled={available.isPending}
              onChange={(e) => setAssetId(e.target.value)}
            >
              <option value="">No specific equipment</option>
              {available.data?.items
                .filter((a) => a.serviceLocationId === order.serviceLocationId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — Serial {a.serialNumber}
                  </option>
                ))}
            </Select>
            {available.isError && (
              <InlineMessage>{available.error.message}</InlineMessage>
            )}
          </Field>
          {save.isError && <InlineMessage>{save.error.message}</InlineMessage>}
          <div className="form-actions">
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button
              appearance="primary"
              disabled={save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Save equipment link"}
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

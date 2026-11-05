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
  Field,
  Input,
  Select,
  Textarea,
} from "@fluentui/react-components";
import {
  ArrowLeft,
  ArrowRight,
  CalendarPlus,
  ClipboardList,
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

export function WorkOrders() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [priority, setPriority] = useState(params.get("priority") ?? "");
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
  return (
    <>
      <PageHeader
        eyebrow="SERVICE MANAGEMENT"
        title="Work orders"
        description="Search, assign, and track service requests in your authorized scope."
        actions={
          auth.can("Dispatcher", "OperationsManager") && (
            <Button
              appearance="primary"
              icon={<Plus size={17} />}
              onClick={() => navigate("/work-orders/new")}
            >
              Create work order
            </Button>
          )
        }
      />
      <Panel
        title="All work orders"
        description={`${filtered.length} ${filtered.length === 1 ? "request" : "requests"} in your authorized scope`}
      >
        <div className="filter-bar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Filter work orders"
              placeholder="Search number, customer, or address…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                updateFilter("q", e.target.value);
              }}
            />
          </div>
          <Select
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
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Work order</th>
                  <th>Customer & location</th>
                  <th>Service category</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((w) => (
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
                        icon={<ArrowRight size={16} />}
                        aria-label={`Open ${w.number}`}
                        onClick={() => navigate(`/work-orders/${w.id}`)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
  const qc = useQueryClient();
  const auth = useAuth();
  const {
    register,
    handleSubmit,
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
  const mutation = useMutation({
    throwOnError: false,
    mutationFn: (body: OrderInput) => post<WorkOrder>("/api/work-orders", body),
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
      <button className="back-link" onClick={() => navigate("/work-orders")}>
        <ArrowLeft size={15} />
        Work orders
      </button>
      <PageHeader
        eyebrow="NEW SERVICE REQUEST"
        title="Create a work order"
        description="Record the customer, site, and service details needed to dispatch the job."
      />
      <div className="form-layout">
        <Panel
          title="Service details"
          description="All information is saved securely to the Work Order Service."
        >
          <form
            className="form-body"
            noValidate
            onSubmit={handleSubmit((v) => mutation.mutate(v))}
          >
            <Field
              label="Work order title"
              required
              validationState={errors.title ? "error" : "none"}
              validationMessage={errors.title?.message}
            >
              <Input
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
                  placeholder="Business or customer name"
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
                placeholder="Street address, city, and access details"
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
                <Input readOnly {...register("teamId")} />
              </Field>
            </div>
            {mutation.isError && (
              <InlineMessage>{mutation.error.message}</InlineMessage>
            )}
            <div className="form-actions">
              <Button onClick={() => navigate("/work-orders")}>Cancel</Button>
              <Button
                appearance="primary"
                type="submit"
                disabled={mutation.isPending}
                icon={<Plus size={16} />}
              >
                {mutation.isPending ? "Creating…" : "Create work order"}
              </Button>
            </div>
          </form>
        </Panel>
        <aside className="form-aside">
          <span className="quick-icon">
            <ClipboardList size={23} />
          </span>
          <h3>A good start saves time in the field.</h3>
          <p>
            Give the request a clear title, confirm the location, and select the
            right service category.
          </p>
          <ol>
            <li>Create the service request</li>
            <li>Review technician recommendations</li>
            <li>Confirm a booking</li>
            <li>Start the guided workflow</li>
          </ol>
          <small>
            Customer information is restricted by role and team. Use synthetic
            data for demonstrations.
          </small>
        </aside>
      </div>
    </>
  );
}
export function OrderDetails() {
  const [editing, setEditing] = useState(false);
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
      <button className="back-link" onClick={() => navigate("/work-orders")}>
        <ArrowLeft size={15} />
        Work orders
      </button>
      <PageHeader
        eyebrow={w.number}
        title={w.title}
        description={`${w.customerName} · ${w.serviceCategory}`}
        actions={
          <>
            <Status value={w.status} />
            {auth.can("Dispatcher", "OperationsManager") && (
              <Button onClick={() => setEditing(true)}>Edit request</Button>
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
              <dt>Customer</dt>
              <dd>{w.customerName}</dd>
            </div>
            <div>
              <dt>Service address</dt>
              <dd>
                <MapPin size={15} />
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
        <Panel
          title="Move service forward"
          description="Plan, execute, and review this work order."
        >
          <div className="detail-actions">
            {auth.can("Dispatcher", "OperationsManager") && (
              <Button
                icon={<CalendarPlus size={17} />}
                onClick={() => navigate(`/schedule?workOrderId=${w.id}`)}
              >
                Schedule service
              </Button>
            )}
            {workflows.data?.map((f) => (
              <Button
                key={f.id}
                appearance="primary"
                icon={<Wrench size={17} />}
                onClick={() => navigate(`/workflow/${f.id}`)}
              >
                {f.status === "Completed"
                  ? "Review completed workflow"
                  : "Continue workflow"}
              </Button>
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
                  icon={<Wrench size={17} />}
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
              <Button
                icon={<History size={17} />}
                onClick={() => navigate(`/replay?workOrderId=${w.id}`)}
              >
                Investigate operational history
              </Button>
            )}
            {start.isError && (
              <InlineMessage>{start.error.message}</InlineMessage>
            )}
          </div>
        </Panel>
      </div>
      {editing && <OrderEditor order={w} onClose={() => setEditing(false)} />}
    </>
  );
}

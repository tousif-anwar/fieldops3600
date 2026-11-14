import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Button, Field, Input, Select } from "@fluentui/react-components";
import { ArrowLeft, Plus, Search } from "lucide-react";
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
import type { Customer, Page } from "../customer-contracts";
import {
  assetIdentity,
  warrantyLabel,
  type Asset,
  type AssetChange,
  type AssetCriticality,
  type AssetInput,
  type AssetType,
} from "../asset-contracts";
import type { WorkOrder } from "../types";

const types: AssetType[] = [
  "HVAC",
  "Refrigeration",
  "Electrical",
  "Plumbing",
  "Controls",
  "Other",
];
const criticalities: AssetCriticality[] = ["Low", "Medium", "High", "Critical"];
const localDate = (value: string) => value.slice(0, 10);
const iso = (value: string) =>
  value ? new Date(`${value}T00:00:00Z`).toISOString() : "";

export function Assets() {
  const auth = useAuth();
  const [params] = useSearchParams();
  const customerId = params.get("customerId") ?? "";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Active");
  const [assetType, setAssetType] = useState("");
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["assets", search, status, assetType, sort, page, customerId],
    queryFn: () =>
      api<Page<Asset>>(
        `/api/assets?${new URLSearchParams({ search, status, assetType, sort, page: String(page), pageSize: "10", ...(customerId ? { customerId } : {}) })}`,
      ),
  });
  const canWrite = auth.can("Dispatcher", "Supervisor", "OperationsManager");
  return (
    <>
      <PageHeader
        title="Assets"
        actions={
          canWrite && (
            <Link
              className="button-link primary"
              to={`/assets/new${customerId ? `?customerId=${customerId}` : ""}`}
            >
              <Plus aria-hidden="true" size={16} />
              Register asset
            </Link>
          )
        }
      />
      <Panel
        title="Registered equipment"
        description="Serial numbers and QR identities stay on authorized operational paths."
      >
        <div className="filter-bar">
          <Input
            name="search-assets"
            autoComplete="off"
            className="search-field"
            contentBefore={<Search size={17} aria-hidden="true" />}
            aria-label="Search assets"
            placeholder="Search name, serial, manufacturer or model…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <Select
            name="asset-status"
            aria-label="Asset status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            <option>Active</option>
            <option>Inactive</option>
            <option>Retired</option>
          </Select>
          <Select
            name="asset-type"
            aria-label="Asset type"
            value={assetType}
            onChange={(e) => {
              setAssetType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
          <Select
            name="sort-assets"
            aria-label="Sort assets"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(1);
            }}
          >
            <option value="name">Name A–Z</option>
            <option value="-name">Name Z–A</option>
            <option value="-created">Newest first</option>
            <option value="-warranty">Warranty expiry</option>
          </Select>
        </div>
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : query.data.items.length === 0 ? (
          <Empty
            title="No matching equipment"
            description="Adjust the filters or register equipment against an active customer location."
          />
        ) : (
          <>
            <div
              tabIndex={0}
              role="region"
              aria-label="Registered equipment"
              className="table-scroll"
            >
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Asset</th>
                    <th scope="col">Type</th>
                    <th scope="col">Criticality</th>
                    <th scope="col">Warranty</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <Link to={`/assets/${a.id}`}>{a.name}</Link>
                        <div className="customer-note">{assetIdentity(a)}</div>
                      </td>
                      <td>{a.assetType}</td>
                      <td>{a.criticality}</td>
                      <td>
                        {a.warrantyEndUtc
                          ? `${localDate(a.warrantyEndUtc)} · ${warrantyLabel(a)}`
                          : "Not recorded"}
                      </td>
                      <td>
                        <Status value={a.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-pagination">
              <span>{query.data.total} matching assets</span>
              <div>
                <Button
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <span>
                  Page {page} of {Math.max(1, Math.ceil(query.data.total / 10))}
                </span>
                <Button
                  disabled={page * 10 >= query.data.total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Panel>
    </>
  );
}

export function AssetEditor() {
  const { id } = useParams();
  const auth = useAuth();
  const [params] = useSearchParams();
  const query = useQuery({
    queryKey: ["asset", id],
    queryFn: () => api<Asset>(`/api/assets/${id}`),
    enabled: !!id,
  });
  if (!auth.can("Dispatcher", "Supervisor", "OperationsManager"))
    return (
      <ErrorState
        error={new Error("Your role cannot change equipment records.")}
      />
    );
  if (id && query.isPending) return <Loading />;
  if (id && query.isError)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  return (
    <AssetForm
      key={id ?? "new"}
      initial={query.data}
      preferredCustomerId={params.get("customerId") ?? undefined}
    />
  );
}

function AssetForm({
  initial,
  preferredCustomerId,
}: {
  initial?: Asset;
  preferredCustomerId?: string;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const customers = useQuery({
    queryKey: ["assets-customer-options"],
    queryFn: () =>
      api<Page<Customer>>(
        "/api/customers?status=Active&pageSize=100&sort=name",
      ),
  });
  const [value, setValue] = useState<AssetInput>(
    () =>
      initial ?? {
        name: "",
        assetType: "HVAC",
        manufacturer: "",
        model: "",
        serialNumber: "",
        qrCode: "",
        criticality: "Medium",
        status: "Active",
        customerId: preferredCustomerId ?? "",
        serviceLocationId: "",
        customerVersion: 0,
        parentAssetId: null,
        installedAtUtc: new Date().toISOString(),
        warrantyEndUtc: "",
      },
  );
  const [validation, setValidation] = useState("");
  const selectedCustomer = customers.data?.items.find(
    (c) => c.id === value.customerId,
  );
  const siblings = useQuery({
    queryKey: ["assets-siblings", value.customerId],
    queryFn: () =>
      api<Page<Asset>>(
        `/api/assets?customerId=${value.customerId}&status=Active&pageSize=100`,
      ),
    enabled: !!value.customerId,
  });
  function field<K extends keyof AssetInput>(key: K, next: AssetInput[K]) {
    setValue((v) => ({ ...v, [key]: next }));
  }
  function chooseCustomer(customerId: string) {
    const customer = customers.data?.items.find((c) => c.id === customerId);
    setValue((v) => ({
      ...v,
      customerId,
      customerVersion: customer?.version ?? 0,
      serviceLocationId:
        customer?.locations.find((l) => l.status === "Active")?.id ?? "",
      parentAssetId: null,
    }));
  }
  const save = useMutation({
    mutationFn: () =>
      initial
        ? api<Asset>(`/api/assets/${initial.id}`, {
            method: "PUT",
            body: JSON.stringify({
              ...value,
              expectedVersion: initial.version,
            }),
          })
        : post<Asset>("/api/assets", value),
    onSuccess: (a) => {
      qc.setQueryData(["asset", a.id], a);
      void qc.invalidateQueries({ queryKey: ["assets"] });
      navigate(`/assets/${a.id}`);
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!value.customerId || !value.serviceLocationId) {
      setValidation("Choose an active customer and service location.");
      return;
    }
    if (
      !selectedCustomer ||
      selectedCustomer.version !== value.customerVersion
    ) {
      setValidation(
        "The customer changed. Reload the customer before saving equipment.",
      );
      return;
    }
    setValidation("");
    save.mutate();
  }
  return (
    <>
      <Link
        className="back-link"
        to={initial ? `/assets/${initial.id}` : "/assets"}
      >
        <ArrowLeft aria-hidden="true" size={15} />
        {initial ? "Asset details" : "Assets"}
      </Link>
      <PageHeader title={initial ? "Edit asset" : "Register asset"} />
      <form onSubmit={submit}>
        <Panel
          title="Equipment identity"
          description="Serial numbers are unique within a team. QR identity is optional and must be unique when present."
        >
          <div className="form-body">
            <Field label="Asset name" required>
              <Input
                name="asset-name"
                autoComplete="off"
                required
                minLength={2}
                maxLength={100}
                value={value.name}
                onChange={(_, d) => field("name", d.value)}
              />
            </Field>
            <div className="form-two">
              <Field label="Asset type">
                <Select
                  name="asset-type"
                  value={value.assetType}
                  onChange={(e) =>
                    field("assetType", e.target.value as AssetType)
                  }
                >
                  {types.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Criticality">
                <Select
                  name="criticality"
                  value={value.criticality}
                  onChange={(e) =>
                    field("criticality", e.target.value as AssetCriticality)
                  }
                >
                  {criticalities.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="form-two">
              <Field label="Manufacturer" required>
                <Input
                  name="manufacturer"
                  autoComplete="off"
                  required
                  minLength={2}
                  maxLength={100}
                  value={value.manufacturer}
                  onChange={(_, d) => field("manufacturer", d.value)}
                />
              </Field>
              <Field label="Model" required>
                <Input
                  name="model"
                  autoComplete="off"
                  required
                  maxLength={100}
                  value={value.model}
                  onChange={(_, d) => field("model", d.value)}
                />
              </Field>
            </div>
            <div className="form-two">
              <Field label="Serial number" required>
                <Input
                  name="serial-number"
                  autoComplete="off"
                  required
                  minLength={2}
                  maxLength={64}
                  pattern="[A-Za-z0-9._-]{2,64}"
                  value={value.serialNumber}
                  onChange={(_, d) => field("serialNumber", d.value)}
                />
              </Field>
              <Field label="QR identity">
                <Input
                  name="qr-identity"
                  autoComplete="off"
                  maxLength={128}
                  value={value.qrCode ?? ""}
                  onChange={(_, d) => field("qrCode", d.value)}
                />
              </Field>
            </div>
            <div className="form-two">
              <Field label="Installed on" required>
                <Input
                  name="installed-on"
                  autoComplete="off"
                  type="date"
                  required
                  value={localDate(value.installedAtUtc)}
                  onChange={(_, d) => field("installedAtUtc", iso(d.value))}
                />
              </Field>
              <Field label="Warranty ends">
                <Input
                  name="warranty-ends"
                  autoComplete="off"
                  type="date"
                  value={
                    value.warrantyEndUtc ? localDate(value.warrantyEndUtc) : ""
                  }
                  onChange={(_, d) =>
                    field("warrantyEndUtc", d.value ? iso(d.value) : "")
                  }
                />
              </Field>
            </div>
          </div>
        </Panel>
        <Panel
          title="Customer location"
          description="Equipment can be registered only for an active customer service location."
        >
          <div className="form-body">
            <Field label="Customer" required>
              <Select
                name="customer"
                required
                value={value.customerId}
                onChange={(e) => chooseCustomer(e.target.value)}
              >
                <option value="">Choose a customer…</option>
                {customers.data?.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Service location" required>
              <Select
                name="service-location"
                required
                value={value.serviceLocationId}
                onChange={(e) => field("serviceLocationId", e.target.value)}
              >
                <option value="">Choose a location…</option>
                {selectedCustomer?.locations
                  .filter((l) => l.status === "Active")
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} — {l.city}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field
              label="Parent equipment"
              hint="The parent must belong to the same customer; hierarchies are limited to five levels."
            >
              <Select
                name="parent-equipment"
                value={value.parentAssetId ?? ""}
                onChange={(e) => field("parentAssetId", e.target.value || null)}
              >
                <option value="">No parent</option>
                {siblings.data?.items
                  .filter((a) => a.id !== initial?.id)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} — {a.serialNumber}
                    </option>
                  ))}
              </Select>
            </Field>
            {initial && (
              <Field
                label="Asset status"
                hint="Retiring equipment is terminal and requires no active child equipment."
              >
                <Select
                  name="asset-status"
                  value={value.status}
                  onChange={(e) =>
                    field("status", e.target.value as AssetInput["status"])
                  }
                >
                  <option>Active</option>
                  <option>Inactive</option>
                  <option disabled={initial.status !== "Retired"}>
                    Retired
                  </option>
                </Select>
              </Field>
            )}
          </div>
        </Panel>
        {validation && <InlineMessage>{validation}</InlineMessage>}
        {save.isError && <InlineMessage>{save.error.message}</InlineMessage>}
        <div className="form-actions">
          <Button
            disabled={save.isPending}
            onClick={() =>
              navigate(initial ? `/assets/${initial.id}` : "/assets")
            }
          >
            Cancel
          </Button>
          <Button appearance="primary" type="submit" disabled={save.isPending}>
            {save.isPending
              ? "Saving…"
              : initial
                ? "Save asset"
                : "Register asset"}
          </Button>
        </div>
      </form>
    </>
  );
}

export function AssetDetails() {
  const { id } = useParams();
  const auth = useAuth();
  const asset = useQuery({
    queryKey: ["asset", id],
    queryFn: () => api<Asset>(`/api/assets/${id}`),
    enabled: !!id,
  });
  const changes = useQuery({
    queryKey: ["asset-history", id],
    queryFn: () => api<AssetChange[]>(`/api/assets/${id}/history`),
    enabled: !!asset.data,
  });
  const orders = useQuery({
    queryKey: ["asset-orders", id],
    queryFn: () =>
      api<Page<WorkOrder>>(`/api/work-orders/by-asset/${id}?pageSize=50`),
    enabled: !!asset.data,
  });
  if (asset.isPending) return <Loading />;
  if (asset.isError)
    return (
      <ErrorState error={asset.error} retry={() => void asset.refetch()} />
    );
  const a = asset.data;
  return (
    <>
      <Link className="back-link" to="/assets">
        <ArrowLeft aria-hidden="true" size={15} />
        Assets
      </Link>
      <PageHeader
        title={a.name}
        description={assetIdentity(a)}
        actions={
          <>
            <Status value={a.status} />
            {auth.can("Dispatcher", "Supervisor", "OperationsManager") && (
              <Link className="button-link" to={`/assets/${a.id}/edit`}>
                Edit asset
              </Link>
            )}
          </>
        }
      />
      <div className="detail-grid">
        <Panel
          title="Equipment"
          description={`${a.assetType} · ${a.criticality} criticality · Version ${a.version}`}
        >
          <p>
            {a.manufacturer} {a.model}
          </p>
          <p>Serial number: {a.serialNumber}</p>
          {a.qrCode && <p>QR identity: {a.qrCode}</p>}
          <p>Installed: {localDate(a.installedAtUtc)}</p>
          <p>
            {a.warrantyEndUtc
              ? `Warranty ends ${localDate(a.warrantyEndUtc)} · ${warrantyLabel(a)}`
              : "No warranty recorded"}
          </p>
          {a.parentAssetId && (
            <p>
              Parent equipment:{" "}
              <Link to={`/assets/${a.parentAssetId}`}>{a.parentAssetId}</Link>
            </p>
          )}
        </Panel>
        <Panel title="Installation history">
          <div
            tabIndex={0}
            role="region"
            aria-label="Installation history"
            className="table-scroll"
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Effective</th>
                  <th scope="col">Location</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {a.locationHistory.map((h) => (
                  <tr key={h.id}>
                    <td>{dateTime(h.effectiveFromUtc)}</td>
                    <td>{h.serviceLocationId}</td>
                    <td>{h.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      <Panel title="Equipment service history">
        {orders.isPending ? (
          <Loading />
        ) : orders.isError ? (
          <ErrorState
            error={orders.error}
            retry={() => void orders.refetch()}
          />
        ) : orders.data.items.length === 0 ? (
          <p className="customer-note">
            No linked work orders. Link this asset when creating or editing an
            order.
          </p>
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-label="Equipment service history"
            className="table-scroll"
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Work order</th>
                  <th scope="col">Service</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {orders.data.items.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link to={`/work-orders/${o.id}`}>{o.number}</Link>
                    </td>
                    <td>{o.title}</td>
                    <td>
                      <Status value={o.status} />
                    </td>
                    <td>{dateTime(o.createdAtUtc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Change history">
        {changes.isPending ? (
          <Loading />
        ) : changes.isError ? (
          <ErrorState
            error={changes.error}
            retry={() => void changes.refetch()}
          />
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-label="Change history"
            className="table-scroll"
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Version</th>
                  <th scope="col">Change</th>
                </tr>
              </thead>
              <tbody>
                {changes.data.map((h) => (
                  <tr key={h.id}>
                    <td>{dateTime(h.occurredAtUtc)}</td>
                    <td>{h.actorId}</td>
                    <td>{h.version}</td>
                    <td>
                      {h.eventType}: {h.changedFields.join(", ")}
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

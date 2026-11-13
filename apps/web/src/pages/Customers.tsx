import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Button,
  Checkbox,
  Field,
  Input,
  Select,
  Textarea,
} from "@fluentui/react-components";
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
import {
  locationAddress,
  type Customer,
  type CustomerChange,
  type CustomerContact,
  type CustomerInput,
  type Page,
  type ServiceLocation,
} from "../customer-contracts";
import type { WorkOrder } from "../types";

const blankLocation = (): ServiceLocation => ({
  name: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  region: "",
  postalCode: "",
  countryCode: "US",
  accessNotes: "",
  status: "Active",
});
const blankContact = (): CustomerContact => ({
  fullName: "",
  email: "",
  phone: "",
  isPrimary: false,
  emailConsent: false,
  phoneConsent: false,
});

export function Customers() {
  const auth = useAuth();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Active");
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["customers", search, status, sort, page],
    queryFn: () =>
      api<Page<Customer>>(
        `/api/customers?${new URLSearchParams({ search, status, sort, page: String(page), pageSize: "10" })}`,
      ),
  });
  const canWrite = auth.can("Dispatcher", "Supervisor", "OperationsManager");
  return (
    <>
      <PageHeader
        eyebrow="CUSTOMER MANAGEMENT"
        title="Customers"
        description="Manage customers, consent and service locations within your authorized team."
        actions={
          canWrite && (
            <Link className="button-link primary" to="/customers/new">
              <Plus size={16} />
              Create customer
            </Link>
          )
        }
      />
      <Panel
        title="Customer registry"
        description="Names and contact details remain on authorized operational paths."
      >
        <div className="filter-bar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Search customers"
              placeholder="Search customer name…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            aria-label="Customer status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            <option>Active</option>
            <option>Archived</option>
          </Select>
          <Select
            aria-label="Sort customers"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(1);
            }}
          >
            <option value="name">Name A–Z</option>
            <option value="-name">Name Z–A</option>
            <option value="-created">Newest first</option>
          </Select>
        </div>
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : query.data.items.length === 0 ? (
          <Empty
            title="No matching customers"
            description="Adjust the filters or register a customer and its service location."
          />
        ) : (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Customer</th>
                    <th scope="col">Type</th>
                    <th scope="col">Locations</th>
                    <th scope="col">Contact preference</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link to={`/customers/${c.id}`}>{c.displayName}</Link>
                      </td>
                      <td>{c.customerType}</td>
                      <td>
                        {
                          c.locations.filter((l) => l.status === "Active")
                            .length
                        }{" "}
                        active
                      </td>
                      <td>{c.preferredChannel}</td>
                      <td>
                        <Status value={c.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-pagination">
              <span>{query.data.total} matching customers</span>
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

export function CustomerEditor() {
  const { id } = useParams();
  const auth = useAuth();
  const query = useQuery({
    queryKey: ["customer", id],
    queryFn: () => api<Customer>(`/api/customers/${id}`),
    enabled: !!id,
  });
  if (!auth.can("Dispatcher", "Supervisor", "OperationsManager"))
    return (
      <ErrorState
        error={new Error("Your role cannot change customer records.")}
      />
    );
  if (id && query.isPending) return <Loading />;
  if (id && query.isError)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  return (
    <CustomerForm
      key={id ?? "new"}
      initial={query.data}
      teamId={String(
        auth.user?.profile.team_id ?? auth.user?.profile.teamId ?? "",
      )}
    />
  );
}

function CustomerForm({
  initial,
  teamId,
}: {
  initial?: Customer;
  teamId: string;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [value, setValue] = useState<CustomerInput>(
    () =>
      initial ?? {
        displayName: "",
        customerType: "Residential",
        teamId,
        status: "Active",
        preferredChannel: "None",
        contacts: [],
        locations: [blankLocation()],
      },
  );
  const [validation, setValidation] = useState("");
  function field<K extends keyof CustomerInput>(
    key: K,
    next: CustomerInput[K],
  ) {
    setValue((v) => ({ ...v, [key]: next }));
  }
  function contact(index: number, patch: Partial<CustomerContact>) {
    setValue((v) => ({
      ...v,
      contacts: v.contacts.map((c, i) =>
        i === index
          ? { ...c, ...patch }
          : patch.isPrimary
            ? { ...c, isPrimary: false }
            : c,
      ),
    }));
  }
  function location(index: number, patch: Partial<ServiceLocation>) {
    setValue((v) => ({
      ...v,
      locations: v.locations.map((l, i) =>
        i === index ? { ...l, ...patch } : l,
      ),
    }));
  }
  const save = useMutation({
    mutationFn: () =>
      initial
        ? api<Customer>(`/api/customers/${initial.id}`, {
            method: "PUT",
            body: JSON.stringify({
              ...value,
              expectedVersion: initial.version,
            }),
          })
        : post<Customer>("/api/customers", value),
    onSuccess: (c) => {
      qc.setQueryData(["customer", c.id], c);
      void qc.invalidateQueries({ queryKey: ["customers"] });
      void qc.invalidateQueries({ queryKey: ["customer-history", c.id] });
      navigate(`/customers/${c.id}`);
    },
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (
      value.status === "Active" &&
      !value.locations.some((l) => l.status === "Active")
    ) {
      setValidation("An active customer needs an active service location.");
      return;
    }
    if (
      value.preferredChannel !== "None" &&
      !value.contacts.some((c) =>
        value.preferredChannel === "Email"
          ? c.email && c.emailConsent
          : c.phone && c.phoneConsent,
      )
    ) {
      setValidation(
        "The preferred channel needs a contact with a matching value and recorded consent.",
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
        to={initial ? `/customers/${initial.id}` : "/customers"}
      >
        <ArrowLeft size={15} />
        {initial ? "Customer details" : "Customers"}
      </Link>
      <PageHeader
        eyebrow="CUSTOMER RECORD"
        title={initial ? "Edit customer" : "Create customer"}
        description="Save the customer, its service locations and contact preferences as one versioned change."
      />
      <form onSubmit={submit} className="customer-form">
        <Panel
          title="Customer details"
          description={
            initial
              ? `Editing version ${initial.version}. Concurrent changes require a fresh review.`
              : "Create a persistent customer before raising a registered service request."
          }
        >
          <div className="form-body">
            <Field label="Customer name" required>
              <Input
                required
                minLength={2}
                maxLength={100}
                value={value.displayName}
                onChange={(_, d) => field("displayName", d.value)}
              />
            </Field>
            <div className="form-two">
              <Field label="Customer type">
                <Select
                  value={value.customerType}
                  onChange={(e) =>
                    field(
                      "customerType",
                      e.target.value as CustomerInput["customerType"],
                    )
                  }
                >
                  <option>Residential</option>
                  <option>Commercial</option>
                </Select>
              </Field>
              <Field label="Team">
                <Input readOnly value={value.teamId} />
              </Field>
            </div>
            <div className="form-two">
              <Field label="Preferred communication">
                <Select
                  value={value.preferredChannel}
                  onChange={(e) =>
                    field(
                      "preferredChannel",
                      e.target.value as CustomerInput["preferredChannel"],
                    )
                  }
                >
                  <option value="None">No preferred channel</option>
                  <option>Email</option>
                  <option>Phone</option>
                </Select>
              </Field>
              <Field
                label="Customer status"
                hint="Archiving prevents new work orders; historical references remain."
              >
                <Select
                  value={value.status}
                  onChange={(e) =>
                    field("status", e.target.value as CustomerInput["status"])
                  }
                >
                  <option>Active</option>
                  <option>Archived</option>
                </Select>
              </Field>
            </div>
          </div>
        </Panel>
        <Panel
          title="Service locations"
          description="Existing locations retain their identity. Archive a closed site to preserve its service history."
        >
          {value.locations.map((l, i) => (
            <fieldset className="customer-subrecord" key={l.id ?? `new-${i}`}>
              <legend>Location {i + 1}</legend>
              <div className="form-body">
                <div className="form-two">
                  <Field label={`Location ${i + 1} name`} required>
                    <Input
                      required
                      minLength={2}
                      maxLength={100}
                      value={l.name}
                      onChange={(_, d) => location(i, { name: d.value })}
                    />
                  </Field>
                  <Field label={`Location ${i + 1} status`}>
                    <Select
                      value={l.status}
                      onChange={(e) =>
                        location(i, {
                          status: e.target.value as ServiceLocation["status"],
                        })
                      }
                    >
                      <option>Active</option>
                      <option>Archived</option>
                    </Select>
                  </Field>
                </div>
                <Field label={`Location ${i + 1} address line 1`} required>
                  <Input
                    required
                    minLength={3}
                    maxLength={200}
                    value={l.addressLine1}
                    onChange={(_, d) => location(i, { addressLine1: d.value })}
                  />
                </Field>
                <Field label={`Location ${i + 1} address line 2`}>
                  <Input
                    maxLength={100}
                    value={l.addressLine2 ?? ""}
                    onChange={(_, d) => location(i, { addressLine2: d.value })}
                  />
                </Field>
                <div className="form-two">
                  <Field label={`Location ${i + 1} city`} required>
                    <Input
                      required
                      minLength={2}
                      maxLength={100}
                      value={l.city}
                      onChange={(_, d) => location(i, { city: d.value })}
                    />
                  </Field>
                  <Field label={`Location ${i + 1} region`}>
                    <Input
                      maxLength={100}
                      value={l.region ?? ""}
                      onChange={(_, d) => location(i, { region: d.value })}
                    />
                  </Field>
                </div>
                <div className="form-two">
                  <Field label={`Location ${i + 1} postal code`} required>
                    <Input
                      required
                      maxLength={20}
                      value={l.postalCode}
                      onChange={(_, d) => location(i, { postalCode: d.value })}
                    />
                  </Field>
                  <Field label={`Location ${i + 1} country code`} required>
                    <Input
                      required
                      minLength={2}
                      maxLength={2}
                      pattern="[A-Za-z]{2}"
                      value={l.countryCode}
                      onChange={(_, d) =>
                        location(i, { countryCode: d.value.toUpperCase() })
                      }
                    />
                  </Field>
                </div>
                <Field label={`Location ${i + 1} access notes`}>
                  <Textarea
                    maxLength={1000}
                    value={l.accessNotes ?? ""}
                    onChange={(_, d) => location(i, { accessNotes: d.value })}
                  />
                </Field>
                {!l.id && value.locations.length > 1 && (
                  <Button
                    onClick={() =>
                      field(
                        "locations",
                        value.locations.filter((_, index) => index !== i),
                      )
                    }
                  >
                    Remove unsaved location {i + 1}
                  </Button>
                )}
              </div>
            </fieldset>
          ))}
          <div className="form-actions">
            <Button
              disabled={value.locations.length >= 100}
              icon={<Plus size={15} />}
              onClick={() =>
                field("locations", [...value.locations, blankLocation()])
              }
            >
              Add location
            </Button>
          </div>
        </Panel>
        <Panel
          title="Contacts and communication consent"
          description="Record consent only when obtained. Saving a preference does not send a message."
        >
          {value.contacts.length === 0 && (
            <p className="customer-note">
              No contacts recorded. A customer may have no preferred
              communication channel.
            </p>
          )}
          {value.contacts.map((c, i) => (
            <fieldset className="customer-subrecord" key={c.id ?? `new-${i}`}>
              <legend>Contact {i + 1}</legend>
              <div className="form-body">
                <Field label={`Contact ${i + 1} name`} required>
                  <Input
                    required
                    minLength={2}
                    maxLength={100}
                    value={c.fullName}
                    onChange={(_, d) => contact(i, { fullName: d.value })}
                  />
                </Field>
                <div className="form-two">
                  <Field label={`Contact ${i + 1} email`}>
                    <Input
                      type="email"
                      maxLength={254}
                      value={c.email ?? ""}
                      onChange={(_, d) =>
                        contact(i, {
                          email: d.value,
                          ...(d.value ? {} : { emailConsent: false }),
                        })
                      }
                    />
                  </Field>
                  <Field label={`Contact ${i + 1} phone`}>
                    <Input
                      type="tel"
                      maxLength={40}
                      value={c.phone ?? ""}
                      onChange={(_, d) =>
                        contact(i, {
                          phone: d.value,
                          ...(d.value ? {} : { phoneConsent: false }),
                        })
                      }
                    />
                  </Field>
                </div>
                <Checkbox
                  label={`Contact ${i + 1} is primary`}
                  checked={c.isPrimary}
                  onChange={(_, d) =>
                    contact(i, { isPrimary: d.checked === true })
                  }
                />
                <Checkbox
                  label={`Contact ${i + 1} email consent recorded`}
                  disabled={!c.email}
                  checked={c.emailConsent}
                  onChange={(_, d) =>
                    contact(i, { emailConsent: d.checked === true })
                  }
                />
                <Checkbox
                  label={`Contact ${i + 1} phone consent recorded`}
                  disabled={!c.phone}
                  checked={c.phoneConsent}
                  onChange={(_, d) =>
                    contact(i, { phoneConsent: d.checked === true })
                  }
                />
                <Button
                  onClick={() =>
                    field(
                      "contacts",
                      value.contacts.filter((_, index) => index !== i),
                    )
                  }
                >
                  Remove contact {i + 1}
                </Button>
              </div>
            </fieldset>
          ))}
          <div className="form-actions">
            <Button
              disabled={value.contacts.length >= 25}
              icon={<Plus size={15} />}
              onClick={() =>
                field("contacts", [...value.contacts, blankContact()])
              }
            >
              Add contact
            </Button>
          </div>
        </Panel>
        {validation && <InlineMessage>{validation}</InlineMessage>}
        {save.isError && <InlineMessage>{save.error.message}</InlineMessage>}
        <div className="form-actions">
          <Button
            disabled={save.isPending}
            onClick={() =>
              navigate(initial ? `/customers/${initial.id}` : "/customers")
            }
          >
            Cancel
          </Button>
          <Button appearance="primary" type="submit" disabled={save.isPending}>
            {save.isPending
              ? "Saving…"
              : initial
                ? "Save customer"
                : "Create customer"}
          </Button>
        </div>
      </form>
    </>
  );
}

export function CustomerDetails() {
  const { id } = useParams();
  const auth = useAuth();
  const [page, setPage] = useState(1);
  const customer = useQuery({
    queryKey: ["customer", id],
    queryFn: () => api<Customer>(`/api/customers/${id}`),
    enabled: !!id,
  });
  const changes = useQuery({
    queryKey: ["customer-history", id],
    queryFn: () => api<CustomerChange[]>(`/api/customers/${id}/history`),
    enabled: !!customer.data,
  });
  const orders = useQuery({
    queryKey: ["customer-orders", id, page],
    queryFn: () =>
      api<Page<WorkOrder>>(
        `/api/work-orders/by-customer/${id}?page=${page}&pageSize=10`,
      ),
    enabled: !!customer.data,
  });
  if (customer.isPending) return <Loading />;
  if (customer.isError)
    return (
      <ErrorState
        error={customer.error}
        retry={() => void customer.refetch()}
      />
    );
  const c = customer.data;
  return (
    <>
      <Link className="back-link" to="/customers">
        <ArrowLeft size={15} />
        Customers
      </Link>
      <PageHeader
        eyebrow="CUSTOMER RECORD"
        title={c.displayName}
        description={`${c.customerType} customer in team ${c.teamId}. Version ${c.version}.`}
        actions={
          <>
            <Status value={c.status} />
            {auth.can("Dispatcher", "Supervisor", "OperationsManager") && (
              <Link className="button-link" to={`/customers/${c.id}/edit`}>
                Edit customer
              </Link>
            )}
            {c.status === "Active" &&
              auth.can("Dispatcher", "OperationsManager") && (
                <Link
                  className="button-link primary"
                  to={`/work-orders/new?customerId=${c.id}`}
                >
                  Create work order
                </Link>
              )}
          </>
        }
      />
      <div className="detail-grid">
        <Panel
          title="Service locations"
          description="Locations retain their original identities when archived."
        >
          {c.locations.map((l) => (
            <section className="customer-subrecord" key={l.id}>
              <h3>{l.name}</h3>
              <Status value={l.status} />
              <p>{locationAddress(l)}</p>
              {l.accessNotes && <p>Access notes: {l.accessNotes}</p>}
            </section>
          ))}
        </Panel>
        <Panel
          title="Contacts"
          description={`Preferred communication: ${c.preferredChannel}. Preferences do not authorize unconsented communication.`}
        >
          {c.contacts.length === 0 ? (
            <p>No contacts recorded.</p>
          ) : (
            c.contacts.map((p) => (
              <section className="customer-subrecord" key={p.id}>
                <h3>
                  {p.fullName}
                  {p.isPrimary ? " (primary)" : ""}
                </h3>
                {p.email && (
                  <p>
                    Email: {p.email} — consent{" "}
                    {p.emailConsent ? "recorded" : "not recorded"}
                  </p>
                )}
                {p.phone && (
                  <p>
                    Phone: {p.phone} — consent{" "}
                    {p.phoneConsent ? "recorded" : "not recorded"}
                  </p>
                )}
              </section>
            ))
          )}
        </Panel>
      </div>
      <Panel
        title="Service history"
        description="Work orders linked to this customer, within your authorized scope."
      >
        {orders.isPending ? (
          <Loading />
        ) : orders.isError ? (
          <ErrorState
            error={orders.error}
            retry={() => void orders.refetch()}
          />
        ) : orders.data.items.length === 0 ? (
          <p className="customer-note">No linked work orders.</p>
        ) : (
          <>
            <div className="table-scroll">
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
            <div className="table-pagination">
              <span>{orders.data.total} linked orders</span>
              <div>
                <Button
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <span>Page {page}</span>
                <Button
                  disabled={page * 10 >= orders.data.total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Panel>
      <Panel
        title="Change history"
        description="Recorded actor, version and changed fields for customer and consent changes."
      >
        {changes.isPending ? (
          <Loading />
        ) : changes.isError ? (
          <ErrorState
            error={changes.error}
            retry={() => void changes.refetch()}
          />
        ) : (
          <div className="table-scroll">
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

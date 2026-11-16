import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  Field,
  Input,
  Select,
} from "@fluentui/react-components";
import { Plus, RefreshCw } from "lucide-react";
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
import type {
  ContractPage,
  ContractSummary,
  MaintenanceContract,
} from "../contract-contracts";
import { contractFrequencies, serviceTypes } from "../contract-contracts";
import { ContractRenewalSection } from "../components/ContractRenewal";

const dateOnly = (value?: string | null) =>
  value ? new Date(`${value}T00:00:00`).toLocaleDateString() : "—";
const inputDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const localDate = () => inputDate(new Date());
const later = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return inputDate(date);
};
const utcDate = (value: string) => new Date(`${value}T00:00:00`).toISOString();
const calendarDate = (value: string | number, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (name: string) =>
    parts.find((item) => item.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};

export function Contracts() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [serviceType, setServiceType] = useState("HVAC");
  const [includedVisits, setIncludedVisits] = useState("2");
  const [partsAllowance, setPartsAllowance] = useState("0");
  const [effectiveFrom, setEffectiveFrom] = useState(localDate);
  const [expiresAt, setExpiresAt] = useState(() => later(365));
  const [frequency, setFrequency] = useState("Quarterly");
  const [planStart, setPlanStart] = useState(localDate);
  const [coversAll, setCoversAll] = useState(true);
  const [assetIds, setAssetIds] = useState("");
  const [generateThrough, setGenerateThrough] = useState(() => later(90));
  const [serviceLocationId, setServiceLocationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const manage = auth.can("Supervisor", "OperationsManager", "Administrator");

  const customers = useQuery({
    queryKey: ["customers", "contract-picker"],
    queryFn: () =>
      api<Page<Customer>>("/api/customers?pageSize=100&status=Active"),
  });
  const contracts = useQuery({
    queryKey: ["contracts", customerId],
    queryFn: () =>
      api<ContractPage>(
        `/api/contracts?pageSize=100${customerId ? `&customerId=${encodeURIComponent(customerId)}` : ""}`,
      ),
  });
  const detail = useQuery({
    queryKey: ["contract", selectedId],
    queryFn: () => api<MaintenanceContract>(`/api/contracts/${selectedId}`),
    enabled: !!selectedId,
  });
  const detailCustomerId = detail.data?.customerId ?? "";
  const serviceCustomer = useQuery({
    queryKey: ["customer", detailCustomerId],
    queryFn: () => api<Customer>(`/api/customers/${detailCustomerId}`),
    enabled: !!detailCustomerId,
  });
  const sites =
    serviceCustomer.data?.locations.filter(
      (site) => site.status === "Active",
    ) ?? [];
  const selectedSite = sites.some((site) => site.id === serviceLocationId)
    ? serviceLocationId
    : "";

  const customerNames = useMemo(
    () =>
      new Map(
        (customers.data?.items ?? []).map((customer) => [
          customer.id,
          customer.displayName,
        ]),
      ),
    [customers.data],
  );
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["contracts"] });
    if (selectedId)
      await queryClient.invalidateQueries({
        queryKey: ["contract", selectedId],
      });
  };
  const command = async (path: string, body: unknown, message: string) => {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      await post(path, body);
      await refresh();
      setNotice(message);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!customerId) {
      setError(new Error("Select a customer before creating an agreement."));
      return;
    }
    const visits = Number(includedVisits);
    const allowance = Number(partsAllowance);
    if (!Number.isInteger(visits) || visits < 0) {
      setError(
        new Error("Included visits must be a nonnegative whole number."),
      );
      return;
    }
    if (!Number.isFinite(allowance) || allowance < 0) {
      setError(new Error("Parts allowance must be a nonnegative amount."));
      return;
    }
    const covered = coversAll
      ? []
      : assetIds
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
          .map((assetId) => ({ assetId, effectiveFrom: planStart }));
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const operationId = crypto.randomUUID();
      const created = await post<MaintenanceContract>("/api/contracts", {
        operationId,
        customerId,
        effectiveFromUtc: utcDate(effectiveFrom),
        expiresAtUtc: utcDate(expiresAt),
        timeZoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
        coversAllAssets: coversAll,
        lines: [
          {
            serviceType,
            laborCovered: true,
            partsCovered: allowance > 0,
            includedVisits: visits,
            partsAllowance: allowance,
          },
        ],
        coveredAssets: covered,
        exclusions: [],
      });
      const line = created.lines[0];
      setSelectedId(created.id);
      if (!line)
        throw new Error("The agreement was created without a coverage line.");
      const planned = await post<MaintenanceContract>(
        `/api/contracts/${created.id}/plans`,
        {
          operationId: crypto.randomUUID(),
          contractId: created.id,
          contractLineId: line.id,
          assetId: null,
          frequency,
          startDate: planStart,
          endsOn: expiresAt,
        },
      );
      const active = await post<MaintenanceContract>(
        `/api/contracts/${created.id}/status`,
        {
          operationId: crypto.randomUUID(),
          contractId: created.id,
          expectedVersion: planned.version,
          status: "Active",
          reason:
            "Agreement created and activated in the operations workspace.",
        },
      );
      setSelectedId(active.id);
      await refresh();
      setNotice("Agreement created with a recurring plan and activated.");
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  const changeStatus = (contract: MaintenanceContract, status: string) =>
    command(
      `/api/contracts/${contract.id}/status`,
      {
        operationId: crypto.randomUUID(),
        contractId: contract.id,
        expectedVersion: contract.version,
        status,
        reason: `Operator requested ${status.toLowerCase()} from the contracts workspace.`,
      },
      `Agreement ${status.toLowerCase()}.`,
    );
  const addPlan = (contract: MaintenanceContract) => {
    const line = contract.lines[0];
    if (!line) return;
    void command(
      `/api/contracts/${contract.id}/plans`,
      {
        operationId: crypto.randomUUID(),
        contractId: contract.id,
        contractLineId: line.id,
        assetId: null,
        serviceLocationId: selectedSite || null,
        frequency,
        startDate:
          planStart <
          calendarDate(contract.effectiveFromUtc, contract.timeZoneId)
            ? calendarDate(contract.effectiveFromUtc, contract.timeZoneId)
            : planStart,
        endsOn: contract.expiresAtUtc
          ? calendarDate(
              new Date(contract.expiresAtUtc).getTime() - 1,
              contract.timeZoneId,
            )
          : null,
      },
      "Recurring plan added.",
    );
  };
  const generate = (contract: MaintenanceContract) =>
    command(
      `/api/contracts/${contract.id}/visits/generate`,
      {
        operationId: crypto.randomUUID(),
        contractId: contract.id,
        throughDate: generateThrough,
      },
      "Recurring visits generated where missing.",
    );
  const selectContract = (contract: ContractSummary) => {
    setSelectedId(contract.id);
    setCustomerId(contract.customerId);
  };
  const loading = customers.isPending || contracts.isPending;
  const mainError = customers.error ?? contracts.error;
  const contract = detail.data;

  return (
    <>
      <PageHeader
        title="Maintenance agreements"
        description="Review coverage and recurring visits, then create maintenance work orders for dispatch."
        actions={
          <Button
            icon={<RefreshCw aria-hidden="true" size={16} />}
            onClick={() => void refresh()}
          >
            Refresh agreements
          </Button>
        }
      />
      {mainError ? (
        <ErrorState error={mainError} retry={() => void refresh()} />
      ) : null}
      {error ? <ErrorState error={error} /> : null}
      {notice ? <InlineMessage success>{notice}</InlineMessage> : null}
      <div className="detail-grid">
        <Panel
          title="Create agreement"
          description="The agreement starts with one covered service line. Equipment coverage can be restricted to explicit asset IDs."
        >
          <form className="form-body" onSubmit={(event) => void create(event)}>
            <Field label="Customer" required>
              <Select
                required
                value={customerId}
                disabled={busy || loading}
                onChange={(event) => setCustomerId(event.target.value)}
              >
                <option value="">Choose an active customer</option>
                {customers.data?.items.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.displayName} · {customer.teamId}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="form-two">
              <Field label="Covered service">
                <Select
                  value={serviceType}
                  disabled={busy}
                  onChange={(event) => setServiceType(event.target.value)}
                >
                  {serviceTypes.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Recurrence">
                <Select
                  value={frequency}
                  disabled={busy}
                  onChange={(event) => setFrequency(event.target.value)}
                >
                  {contractFrequencies.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="form-two">
              <Field
                label="Included visits"
                hint="Zero means unlimited covered visits."
              >
                <Input
                  type="number"
                  min="0"
                  max="10000"
                  value={includedVisits}
                  disabled={busy}
                  onChange={(event) => setIncludedVisits(event.target.value)}
                />
              </Field>
              <Field
                label="Parts allowance"
                hint="Used to decide covered parts."
              >
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={partsAllowance}
                  disabled={busy}
                  onChange={(event) => setPartsAllowance(event.target.value)}
                />
              </Field>
            </div>
            <div className="form-two">
              <Field label="Effective date">
                <Input
                  type="date"
                  value={effectiveFrom}
                  disabled={busy}
                  onChange={(event) => setEffectiveFrom(event.target.value)}
                />
              </Field>
              <Field label="Expiration date">
                <Input
                  type="date"
                  value={expiresAt}
                  disabled={busy}
                  onChange={(event) => setExpiresAt(event.target.value)}
                />
              </Field>
            </div>
            <div className="form-two">
              <Field label="First visit">
                <Input
                  type="date"
                  value={planStart}
                  disabled={busy}
                  onChange={(event) => setPlanStart(event.target.value)}
                />
              </Field>
              <Field label="Coverage scope">
                <Checkbox
                  checked={coversAll}
                  disabled={busy}
                  label="All equipment owned by this customer"
                  onChange={(_, data) => setCoversAll(!!data.checked)}
                />
              </Field>
            </div>
            {!coversAll ? (
              <Field
                label="Covered equipment IDs"
                hint="Comma-separated asset IDs. Each must belong to the selected customer."
              >
                <Input
                  value={assetIds}
                  disabled={busy}
                  onChange={(event) => setAssetIds(event.target.value)}
                  placeholder="Asset UUIDs"
                />
              </Field>
            ) : null}
            <Button
              type="submit"
              appearance="primary"
              icon={<Plus size={16} />}
              disabled={busy || loading || !manage}
            >
              {busy ? "Saving agreement…" : "Create and activate"}
            </Button>
          </form>
        </Panel>
        <Panel
          title="Agreement register"
          description="Only agreements for your authorized team are shown."
        >
          {loading ? <Loading label="Loading agreements…" /> : null}
          {contracts.data?.items.length === 0 ? (
            <Empty
              title="No agreements"
              description="Create an agreement for an active customer."
            />
          ) : (
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Maintenance agreements"
            >
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Customer</th>
                    <th scope="col">Status</th>
                    <th scope="col">Effective</th>
                    <th scope="col">Lines</th>
                    <th scope="col">Next visit</th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.data?.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <Button
                          appearance="transparent"
                          onClick={() => selectContract(item)}
                        >
                          {customerNames.get(item.customerId) ??
                            item.customerId}
                        </Button>
                      </td>
                      <td>
                        <Status value={item.status} />
                      </td>
                      <td>{dateOnly(item.effectiveFromUtc.slice(0, 10))}</td>
                      <td>{item.lineCount}</td>
                      <td>{dateOnly(item.nextVisit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      {selectedId ? (
        <Panel
          title="Agreement detail"
          description="Entitlements are consumed only by recorded work-order usage; generating a visit does not consume one."
          action={
            <Button onClick={() => setSelectedId("")} appearance="subtle">
              Close
            </Button>
          }
        >
          {detail.isPending ? <Loading label="Loading agreement…" /> : null}
          {detail.error ? (
            <ErrorState
              error={detail.error}
              retry={() => void detail.refetch()}
            />
          ) : null}
          {contract ? (
            <>
              <div className="inline-message">
                <span>
                  <Status value={contract.status} /> · Version{" "}
                  {contract.version} · {contract.timeZoneId}
                </span>
                <span>
                  {dateOnly(
                    calendarDate(
                      contract.effectiveFromUtc,
                      contract.timeZoneId,
                    ),
                  )}{" "}
                  →{" "}
                  {contract.expiresAtUtc
                    ? dateOnly(
                        calendarDate(
                          contract.expiresAtUtc,
                          contract.timeZoneId,
                        ),
                      )
                    : "—"}
                </span>
              </div>
              {manage ? (
                <div className="page-actions">
                  {contract.status === "Draft" ||
                  contract.status === "Suspended" ? (
                    <Button
                      disabled={busy}
                      onClick={() => void changeStatus(contract, "Active")}
                    >
                      Activate
                    </Button>
                  ) : null}
                  {contract.status === "Active" ? (
                    <Button
                      disabled={busy}
                      onClick={() => void changeStatus(contract, "Suspended")}
                    >
                      Suspend
                    </Button>
                  ) : null}
                  {contract.status !== "Cancelled" ? (
                    <Button
                      disabled={busy}
                      onClick={() => void changeStatus(contract, "Cancelled")}
                    >
                      Cancel agreement
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Coverage lines"
              >
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Service</th>
                      <th scope="col">Labor</th>
                      <th scope="col">Parts</th>
                      <th scope="col">Visits used</th>
                      <th scope="col">Remaining</th>
                      <th scope="col">Parts allowance remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contract.lines.map((line) => (
                      <tr key={line.id}>
                        <td>{line.serviceType}</td>
                        <td>{line.laborCovered ? "Covered" : "Billable"}</td>
                        <td>{line.partsCovered ? "Covered" : "Billable"}</td>
                        <td>
                          {line.visitsUsed} / {line.includedVisits === 0 ? "Unlimited" : line.includedVisits}
                        </td>
                        <td>{line.visitsRemaining ?? "Unlimited"}</td>
                        <td>
                          {line.partsCovered
                            ? (line.partsAllowance - line.partsUsed).toFixed(2)
                            : "Billable"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="detail-grid">
                <div>
                  <h3>Recurring plans</h3>
                  {contract.plans.length === 0 ? (
                    <p>No plan yet.</p>
                  ) : (
                    <div
                      className="table-scroll"
                      tabIndex={0}
                      role="region"
                      aria-label="Recurring plans"
                    >
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th scope="col">Frequency</th>
                            <th scope="col">Next due</th>
                            <th scope="col">Ends</th>
                            <th scope="col">Active</th>
                          </tr>
                        </thead>
                        <tbody>
                          {contract.plans.map((plan) => (
                            <tr key={plan.id}>
                              <td>{plan.frequency}</td>
                              <td>{dateOnly(plan.nextDueDate)}</td>
                              <td>{dateOnly(plan.endsOn)}</td>
                              <td>{plan.active ? "Yes" : "No"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {manage ? (
                    <div className="form-body">
                      <div className="form-two">
                        <Field label="Plan start">
                          <Input
                            type="date"
                            value={
                              planStart <
                              calendarDate(
                                contract.effectiveFromUtc,
                                contract.timeZoneId,
                              )
                                ? calendarDate(
                                    contract.effectiveFromUtc,
                                    contract.timeZoneId,
                                  )
                                : planStart
                            }
                            min={calendarDate(
                              contract.effectiveFromUtc,
                              contract.timeZoneId,
                            )}
                            onChange={(event) =>
                              setPlanStart(event.target.value)
                            }
                          />
                        </Field>
                        <Field label="Frequency">
                          <Select
                            value={frequency}
                            onChange={(event) =>
                              setFrequency(event.target.value)
                            }
                          >
                            {contractFrequencies.map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                      <Button disabled={busy} onClick={() => addPlan(contract)}>
                        Add recurring plan
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div>
                  <h3>Generate upcoming visits</h3>
                  <p>
                    Visits are idempotent and stop at the agreement expiration.
                    Dispatch remains responsible for technician assignment.
                  </p>
                  {manage ? (
                    <div className="form-body">
                      <Field label="Generate through">
                        <Input
                          type="date"
                          value={generateThrough}
                          onChange={(event) =>
                            setGenerateThrough(event.target.value)
                          }
                        />
                      </Field>
                      <Button
                        disabled={busy || contract.status !== "Active"}
                        onClick={() => void generate(contract)}
                      >
                        Generate visits
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
              <h3>Upcoming and recorded visits</h3>
              {serviceCustomer.error ? (
                <ErrorState
                  error={serviceCustomer.error}
                  retry={() => void serviceCustomer.refetch()}
                />
              ) : null}
              <Field
                label="Service location for maintenance dispatch"
                hint="Choose the customer's site before creating a job. Technician assignment remains in Schedule."
              >
                <Select
                  value={selectedSite}
                  onChange={(event) => setServiceLocationId(event.target.value)}
                >
                  <option value="">Select service location</option>
                  {sites.map((site) => (
                    <option value={site.id} key={site.id}>
                      {site.name} · {site.addressLine1}
                    </option>
                  ))}
                </Select>
              </Field>
              {contract.visits.length === 0 ? (
                <p>No visits generated.</p>
              ) : (
                <div
                  className="table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Maintenance visits"
                >
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Due</th>
                        <th scope="col">Service</th>
                        <th scope="col">Status</th>
                        <th scope="col">Work order</th>
                        <th scope="col">Dispatch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contract.visits.map((visit) => (
                        <tr key={visit.id}>
                          <td>{dateOnly(visit.dueDate)}</td>
                          <td>
                            {contract.lines.find(
                              (line) => line.id === visit.contractLineId,
                            )?.serviceType ?? "—"}
                          </td>
                          <td>
                            <Status value={visit.status} />
                            {visit.completionReviewRequired ? <p role="status">Coverage review required: {visit.completionReviewReason}</p> : null}
                          </td>
                          <td>
                            {visit.workOrderId ? (
                              <Link to={`/work-orders/${visit.workOrderId}`}>
                                Open work order
                              </Link>
                            ) : (
                              "Not created"
                            )}
                          </td>
                          <td>
                            {visit.workOrderId ? (
                              <Link to="/schedule">Open Schedule</Link>
                            ) : visit.status === "Pending" ||
                              visit.status === "Dispatching" ? (
                              <Button
                                disabled={
                                  busy ||
                                  !(visit.serviceLocationId || selectedSite) ||
                                  contract.status !== "Active"
                                }
                                onClick={() =>
                                  void command(
                                    `/api/contracts/${contract.id}/visits/${visit.id}/dispatch`,
                                    {
                                      operationId: crypto.randomUUID(),
                                      serviceLocationId:
                                        visit.serviceLocationId || selectedSite,
                                    },
                                    "Maintenance work order created. Review and assign it in Schedule.",
                                  )
                                }
                              >
                                {visit.status === "Dispatching"
                                  ? "Retry creating work order"
                                  : "Create work order"}
                              </Button>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <h3>Usage evidence</h3>
              {contract.usage.length === 0 ? (
                <p>No visit or parts usage recorded.</p>
              ) : (
                <dl className="detail-list">
                  {contract.usage.map((usage) => (
                    <div key={usage.id}>
                      <dt>{dateTime(usage.occurredAtUtc)}</dt>
                      <dd>
                        {usage.visitsUsed} visit(s) ·{" "}
                        {usage.partsCost.toFixed(2)} parts · work order{" "}
                        {usage.workOrderId}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {manage ? (
                <ContractRenewalSection
                  key={`${contract.id}:${contract.version}`}
                  contract={contract}
                  onOpen={setSelectedId}
                />
              ) : null}
            </>
          ) : null}
        </Panel>
      ) : null}
    </>
  );
}

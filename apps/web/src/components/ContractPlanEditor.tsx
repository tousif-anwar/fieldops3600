import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Field, Input, Select } from "@fluentui/react-components";
import { api } from "../api";
import type {
  MaintenanceContract,
  MaintenancePlan,
} from "../contract-contracts";
import { contractFrequencies } from "../contract-contracts";
import { ErrorState, InlineMessage } from "./common";

function localDay(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function ContractPlanEditor({
  contract,
  plan,
  sites,
}: {
  contract: MaintenanceContract;
  plan: MaintenancePlan;
  sites: { id: string; name: string }[];
}) {
  const queryClient = useQueryClient();
  const lastDue = contract.visits
    .filter(
      (visit) =>
        visit.contractLineId === plan.contractLineId &&
        (visit.assetId ?? null) === (plan.assetId ?? null),
    )
    .map((visit) => visit.dueDate)
    .sort()
    .at(-1);
  const afterHistory = lastDue
    ? new Date(Date.parse(`${lastDue}T00:00:00Z`) + 86400000)
        .toISOString()
        .slice(0, 10)
    : "";
  const minimum = [
    localDay(new Date(), contract.timeZoneId),
    localDay(new Date(contract.effectiveFromUtc), contract.timeZoneId),
    afterHistory,
  ]
    .sort()
    .at(-1)!;
  const maximum = contract.expiresAtUtc
    ? localDay(
        new Date(Date.parse(contract.expiresAtUtc) - 1),
        contract.timeZoneId,
      )
    : undefined;
  const [frequency, setFrequency] = useState(plan.frequency);
  const [starts, setStarts] = useState(
    [minimum, plan.nextDueDate].sort().at(-1)!,
  );
  const [ends, setEnds] = useState(
    plan.endsOn && maximum
      ? [plan.endsOn, maximum].sort()[0]
      : (plan.endsOn ?? ""),
  );
  const [site, setSite] = useState(plan.serviceLocationId ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/contracts/${contract.id}/plans/${plan.id}`, {
        method: "PUT",
        body: JSON.stringify({
          operationId: crypto.randomUUID(),
          expectedContractVersion: contract.version,
          expectedPlanVersion: plan.version,
          frequency,
          firstNewDue: starts,
          endsOn: ends || null,
          serviceLocationId: site,
          reason,
        }),
      });
      setSaved(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["contract", contract.id] }),
        queryClient.invalidateQueries({ queryKey: ["contracts"] }),
      ]);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  const service =
    contract.lines.find((line) => line.id === plan.contractLineId)
      ?.serviceType ?? "Maintenance";
  return (
    <details className="customer-subrecord">
      <summary>
        Change {service} recurrence · next due {plan.nextDueDate}
      </summary>
      <p>
        Existing visits and work orders keep their dates. The new cadence starts
        after {lastDue ?? "the agreement's effective date"}, in{" "}
        {contract.timeZoneId}.
      </p>
      {error ? <ErrorState error={error} /> : null}
      {saved ? (
        <InlineMessage success>New recurrence recorded.</InlineMessage>
      ) : null}
      <form className="form-body" onSubmit={(event) => void submit(event)}>
        <div className="form-two">
          <Field label="New recurrence">
            <Select
              value={frequency}
              disabled={busy}
              onChange={(event) => setFrequency(event.target.value)}
            >
              {contractFrequencies.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </Select>
          </Field>
          <Field label="First date in new cadence" required>
            <Input
              type="date"
              required
              min={minimum}
              max={maximum}
              value={starts}
              disabled={busy}
              onChange={(event) => setStarts(event.target.value)}
            />
          </Field>
        </div>
        <Field
          label="New plan end"
          hint="Leave blank to use the agreement's expiration."
        >
          <Input
            type="date"
            min={starts}
            max={maximum}
            value={ends}
            disabled={busy}
            onChange={(event) => setEnds(event.target.value)}
          />
        </Field>
        <Field label="New plan service location" required>
          <Select
            required
            value={site}
            disabled={busy}
            onChange={(event) => setSite(event.target.value)}
          >
            <option value="">Choose an active service location</option>
            {sites.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Recurrence change reason" required>
          <Input
            required
            minLength={3}
            maxLength={500}
            value={reason}
            disabled={busy}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <Button
          type="submit"
          disabled={busy || (!!maximum && minimum > maximum)}
        >
          {busy ? "Saving recurrence…" : "Save new recurrence"}
        </Button>
        {maximum && minimum > maximum ? (
          <p>Renew this agreement before adding dates beyond its term.</p>
        ) : null}
      </form>
    </details>
  );
}

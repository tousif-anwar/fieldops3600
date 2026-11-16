import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Field, Input } from "@fluentui/react-components";
import { api, post } from "../api";
import type {
  MaintenanceContract,
  ContractRenewal,
} from "../contract-contracts";
import { dateTime } from "../format";
import { ErrorState, InlineMessage, Loading } from "./common";

const inputTime = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 19);
};

export function ContractRenewalSection({
  contract,
  onOpen,
}: {
  contract: MaintenanceContract;
  onOpen: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const initialStart = new Date(
    Math.ceil(new Date(contract.expiresAtUtc ?? Date.now()).getTime() / 1000) *
      1000,
  );
  const initialEnd = new Date(initialStart);
  initialEnd.setFullYear(initialEnd.getFullYear() + 1);
  const [starts, setStarts] = useState(() => inputTime(initialStart));
  const [ends, setEnds] = useState(() => inputTime(initialEnd));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<ContractRenewal | null>(null);
  const history = useQuery({
    queryKey: ["contract-renewals", contract.id],
    queryFn: () =>
      api<ContractRenewal[]>(`/api/contracts/${contract.id}/renewals`),
  });
  const existing = history.data?.find(
    (item) => item.sourceContractId === contract.id,
  );
  const canRenew =
    ["Active", "Suspended", "Expired"].includes(contract.status) &&
    !!contract.expiresAtUtc &&
    !existing &&
    !created;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await post<ContractRenewal>(
        `/api/contracts/${contract.id}/renewals`,
        {
          operationId: crypto.randomUUID(),
          expectedVersion: contract.version,
          effectiveFromUtc: new Date(starts).toISOString(),
          expiresAtUtc: new Date(ends).toISOString(),
          reason,
        },
      );
      setCreated(result);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["contracts"] }),
        queryClient.invalidateQueries({
          queryKey: ["contract-renewals", contract.id],
        }),
      ]);
    } catch (cause) {
      setError(cause);
      void history.refetch();
    } finally {
      setBusy(false);
    }
  };
  const linked = created ?? existing;
  return (
    <section aria-label="Agreement renewal" className="form-body">
      <h3>Renewal</h3>
      <p>
        A renewal creates a separate draft with fresh allowances. Review its
        terms, configure a new recurring plan, and activate it when ready.
      </p>
      {history.isPending ? <Loading label="Loading renewal history…" /> : null}
      {history.error ? (
        <ErrorState
          error={history.error}
          retry={() => void history.refetch()}
        />
      ) : null}
      {error ? <ErrorState error={error} /> : null}
      {linked ? (
        <InlineMessage success>
          Renewal draft recorded.{" "}
          <Button
            appearance="transparent"
            onClick={() => onOpen(linked.renewedContractId)}
          >
            Open renewal draft
          </Button>
        </InlineMessage>
      ) : null}
      {canRenew && history.isSuccess ? (
        <form className="form-body" onSubmit={(event) => void submit(event)}>
          <p>
            Dates use your browser time zone:{" "}
            {Intl.DateTimeFormat().resolvedOptions().timeZone}. The new start
            must be at or after this agreement expires.
          </p>
          <div className="form-two">
            <Field label="Renewal starts" required>
              <Input
                required
                type="datetime-local"
                step={1}
                value={starts}
                disabled={busy}
                onChange={(event) => setStarts(event.target.value)}
              />
            </Field>
            <Field label="Renewal expires" required>
              <Input
                required
                type="datetime-local"
                step={1}
                value={ends}
                disabled={busy}
                onChange={(event) => setEnds(event.target.value)}
              />
            </Field>
          </div>
          <Field label="Renewal reason" required>
            <Input
              required
              minLength={3}
              maxLength={500}
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating renewal…" : "Create renewal draft"}
          </Button>
        </form>
      ) : null}
      {history.data?.map((item) => (
        <div key={item.id}>
          <span>
            {dateTime(item.recordedAtUtc)} · {item.reason} ·{" "}
          </span>
          <Button
            appearance="transparent"
            onClick={() =>
              onOpen(
                item.sourceContractId === contract.id
                  ? item.renewedContractId
                  : item.sourceContractId,
              )
            }
          >
            {item.sourceContractId === contract.id
              ? "View renewed agreement"
              : "View previous agreement"}
          </Button>
        </div>
      ))}
    </section>
  );
}

import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Field, Input, Select } from "@fluentui/react-components";
import { api } from "../api";
import type { MaintenanceContract } from "../contract-contracts";
import { parseContractSlaInput } from "../contract-contracts";
import { ErrorState, InlineMessage } from "./common";

export function ContractSlaTermsEditor({
  contract,
  onSaved,
}: {
  contract: MaintenanceContract;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const [expectedVersion] = useState(contract.version);
  const [clockOrigin, setClockOrigin] = useState<string>(
    contract.slaClockOrigin ?? "",
  );
  const [lines, setLines] = useState(() =>
    contract.lines.map((line) => ({
      contractLineId: line.id,
      serviceType: line.serviceType,
      active: line.active,
      response: line.responseTargetMinutes?.toString() ?? "",
      completion: line.completionTargetMinutes?.toString() ?? "",
    })),
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const updateLine = (
    id: string,
    field: "response" | "completion",
    value: string,
  ) => {
    setLines((current) =>
      current.map((line) =>
        line.contractLineId === id ? { ...line, [field]: value } : line,
      ),
    );
    setSaved(false);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaved(false);
    try {
      const targets = lines.map((line) => {
        const parsed = parseContractSlaInput(
          clockOrigin,
          line.response,
          line.completion,
        );
        return {
          contractLineId: line.contractLineId,
          responseTargetMinutes: parsed.responseTargetMinutes,
          completionTargetMinutes: parsed.completionTargetMinutes,
        };
      });
      if (reason.trim().length < 3 || reason.trim().length > 500)
        throw new Error(
          "Give a service target change reason between 3 and 500 characters.",
        );
      setBusy(true);
      await api(`/api/contracts/${contract.id}/sla-terms`, {
        method: "PUT",
        body: JSON.stringify({
          operationId: crypto.randomUUID(),
          expectedVersion,
          clockOrigin: clockOrigin || null,
          lines: targets,
          reason: reason.trim(),
        }),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["contract", contract.id] }),
        queryClient.invalidateQueries({ queryKey: ["contracts"] }),
      ]);
      setSaved(true);
      onSaved?.();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="customer-subrecord">
      <summary>Change agreement service targets</summary>
      <p>
        Targets apply to future work orders. Existing work orders keep their
        recorded terms.
      </p>
      <p>
        Service starts means technician service begins. Both targets use elapsed
        UTC minutes from the same origin; workflow pauses do not extend them.
      </p>
      {error ? <ErrorState error={error} /> : null}
      {saved ? (
        <InlineMessage success>
          Service targets saved for future work orders.
        </InlineMessage>
      ) : null}
      <form className="form-body" onSubmit={(event) => void submit(event)}>
        <Field
          label="Service target clock"
          hint="For future maintenance, appointment start begins the clock at the scheduled start."
        >
          <Select
            value={clockOrigin}
            disabled={busy}
            onChange={(event) => {
              setClockOrigin(event.target.value);
              setSaved(false);
            }}
          >
            <option value="">No clock selected</option>
            <option value="WorkOrderCreated">Work order creation</option>
            <option value="AppointmentStart">Appointment start</option>
          </Select>
        </Field>
        {lines.map((line) => (
          <fieldset className="customer-subrecord" key={line.contractLineId}>
            <legend>
              {line.serviceType}
              {line.active ? "" : " · Inactive line"}
            </legend>
            <div className="form-two">
              <Field
                label={`${line.serviceType} service starts within (minutes)`}
                hint="Leave blank for no service start target."
              >
                <Input
                  type="number"
                  min={1}
                  max={2147483647}
                  step={1}
                  value={line.response}
                  disabled={busy}
                  onChange={(event) =>
                    updateLine(
                      line.contractLineId,
                      "response",
                      event.target.value,
                    )
                  }
                />
              </Field>
              <Field
                label={`${line.serviceType} service completes within (minutes)`}
                hint="Total time from the same origin, not additional time after service starts."
              >
                <Input
                  type="number"
                  min={1}
                  max={2147483647}
                  step={1}
                  value={line.completion}
                  disabled={busy}
                  onChange={(event) =>
                    updateLine(
                      line.contractLineId,
                      "completion",
                      event.target.value,
                    )
                  }
                />
              </Field>
            </div>
          </fieldset>
        ))}
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            setClockOrigin("");
            setLines((current) =>
              current.map((line) => ({
                ...line,
                response: "",
                completion: "",
              })),
            );
            setSaved(false);
          }}
        >
          Clear all targets
        </Button>
        <Field label="Service target change reason" required>
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
          {busy ? "Saving service targets…" : "Save service targets"}
        </Button>
      </form>
    </details>
  );
}

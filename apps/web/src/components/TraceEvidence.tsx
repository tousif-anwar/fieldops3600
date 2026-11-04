import { useEffect, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import { ArrowUpRight } from "lucide-react";
import { ApiError, getTraceAvailability, type TraceAvailability } from "../api";
import { dateTime } from "../format";

export function TraceEvidence({
  traceId,
  correlationId,
  workOrderId,
}: {
  traceId?: string;
  correlationId: string;
  workOrderId: string;
}) {
  const [availability, setAvailability] = useState<TraceAvailability | null>(
    null,
  );
  const [error, setError] = useState<
    "restricted" | "expired_session" | "unknown" | null
  >(null);
  const [checking, setChecking] = useState(false);
  const sequence = useRef(0);
  useEffect(() => {
    sequence.current++;
    setAvailability(null);
    setError(null);
    setChecking(false);
    return () => {
      sequence.current++;
    };
  }, [workOrderId, traceId]);
  const jaeger = import.meta.env.VITE_JAEGER_URL ?? "http://localhost:16686";
  const check = async () => {
    if (!traceId) return;
    const requestSequence = ++sequence.current;
    setChecking(true);
    setAvailability(null);
    setError(null);
    try {
      const result = await getTraceAvailability(workOrderId, traceId);
      if (sequence.current === requestSequence) setAvailability(result);
    } catch (failure) {
      if (sequence.current === requestSequence)
        setError(
          failure instanceof ApiError && [403, 404].includes(failure.status)
            ? "restricted"
            : failure instanceof ApiError && failure.status === 401
              ? "expired_session"
              : "unknown",
        );
    } finally {
      if (sequence.current === requestSequence) setChecking(false);
    }
  };
  return (
    <div className="trace-card">
      <h4>Trace correlation</h4>
      {traceId ? (
        <>
          <code>{traceId}</code>
          {availability?.available === true ? (
            <a
              href={`${jaeger}/trace/${encodeURIComponent(traceId)}`}
              target="_blank"
              rel="noreferrer"
            >
              Open trace in Jaeger <ArrowUpRight size={14} />
            </a>
          ) : (
            <Button
              size="small"
              appearance="subtle"
              disabled={checking}
              onClick={() => void check()}
            >
              {checking ? "Checking trace…" : "Check trace availability"}
            </Button>
          )}
          {availability?.reason === "not_retained" ? (
            <small>
              No trace is available for this identifier. It may have expired
              from Jaeger or been omitted by trace sampling. The audit metadata
              remains available.
            </small>
          ) : availability?.available === false ? (
            <small>
              Trace availability is currently unknown.{" "}
              {availability.reason === "not_configured"
                ? "The trace provider is not configured."
                : availability.reason === "timeout"
                  ? "The trace provider timed out."
                  : availability.reason === "upstream_error"
                    ? "The trace provider returned an error."
                    : "The trace provider is unreachable."}{" "}
              This does not establish that the trace has expired. The audit
              identifier is retained.
            </small>
          ) : error === "restricted" ? (
            <small>
              Trace availability is not accessible for this work order. Your
              account may not have permission, or the record may no longer be
              available.
            </small>
          ) : error === "expired_session" ? (
            <small>
              Your session has expired. Sign in again to check trace
              availability.
            </small>
          ) : error === "unknown" ? (
            <small>
              Trace availability could not be confirmed. Try again when the
              replay service is reachable. The retained identifier does not
              prove that a trace is currently available.
            </small>
          ) : (
            <small>
              Trace retention is separate from immutable event retention. The
              authorized replay service checks availability before opening a
              specific trace. Raw spans are not returned to this console.
            </small>
          )}
          {availability && (
            <small>
              Checked {dateTime(availability.checkedAtUtc)}
              {availability.available === true && availability.spanCount != null
                ? ` · ${availability.spanCount} recorded spans`
                : ""}
            </small>
          )}
        </>
      ) : (
        <p>No trace was captured for this event.</p>
      )}
      <small className="trace-correlation">
        Correlation <code>{correlationId}</code>
      </small>
    </div>
  );
}

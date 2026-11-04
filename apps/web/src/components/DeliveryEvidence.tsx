import type { DeliveryAttempt } from "../types";
import { dateTime } from "../format";
import { Status } from "./common";

export function DeliveryEvidence({
  retryCount,
  attempts,
}: {
  retryCount: number | null;
  attempts: DeliveryAttempt[];
}) {
  return (
    <section
      className="delivery-evidence"
      aria-label="Message delivery evidence"
    >
      <dl className="event-dl">
        <div>
          <dt>Recorded retries</dt>
          <dd>{retryCount == null ? "Unknown" : retryCount}</dd>
        </div>
      </dl>
      {retryCount == null && (
        <p className="delivery-uncertainty">
          The transport did not provide a reliable attempt total. Terminal fault
          evidence does not establish the number of earlier retries.
        </p>
      )}
      {attempts.length > 0 && (
        <div className="delivery-attempts">
          <h4>Delivery observations</h4>
          {attempts.map((attempt, index) => (
            <div key={`${attempt.faultId ?? attempt.attempt}-${index}`}>
              <span>
                {attempt.attempt == null
                  ? "Attempt unknown"
                  : `Attempt ${attempt.attempt}`}
              </span>
              <Status value={attempt.status} />
              {attempt.occurredAtUtc && (
                <small>Observed {dateTime(attempt.occurredAtUtc)}</small>
              )}
              <small>Received {dateTime(attempt.receivedAtUtc)}</small>
              {attempt.processedAtUtc && (
                <small>Processed {dateTime(attempt.processedAtUtc)}</small>
              )}
              {attempt.consumerService && (
                <small>Consumer: {attempt.consumerService}</small>
              )}
              {attempt.faultId && (
                <small className="delivery-fault-id">
                  Fault: <code>{attempt.faultId}</code>
                </small>
              )}
              {attempt.error && <p>{attempt.error}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

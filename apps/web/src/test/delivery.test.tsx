import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeliveryEvidence } from "../components/DeliveryEvidence";

describe("message delivery evidence", () => {
  it("shows unknown attempt totals and retains terminal fault provenance without inventing a retry number", () => {
    render(
      <DeliveryEvidence
        retryCount={null}
        attempts={[
          {
            attempt: null,
            receivedAtUtc: "2026-11-04T14:00:00Z",
            status: "DeadLettered",
            consumerService: "work-orders",
            faultId: "fault-123",
            error: "InvalidOperationException",
          },
        ]}
      />,
    );
    expect(screen.getByText("Unknown", { exact: true })).toBeVisible();
    expect(screen.getByText("Attempt unknown", { exact: true })).toBeVisible();
    expect(screen.getByText("Consumer: work-orders")).toBeVisible();
    expect(screen.getByText("fault-123")).toBeVisible();
    expect(screen.getByText("Dead Lettered").closest(".status")).toHaveClass(
      "status-danger",
    );
    expect(screen.queryByText("Attempt 0")).not.toBeInTheDocument();
  });
  it("preserves an explicitly recorded zero retry count as different evidence from unknown", () => {
    render(<DeliveryEvidence retryCount={0} attempts={[]} />);
    expect(screen.getByText("0", { exact: true })).toBeVisible();
    expect(
      screen.queryByText("Unknown", { exact: true }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/did not provide a reliable attempt total/),
    ).not.toBeInTheDocument();
  });
});

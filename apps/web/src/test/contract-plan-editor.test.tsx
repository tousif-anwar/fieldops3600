import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ContractPlanEditor } from "../components/ContractPlanEditor";
import type {
  MaintenanceContract,
  MaintenancePlan,
} from "../contract-contracts";
import { api } from "../api";

vi.mock("../auth", () => ({ manager: { getUser: vi.fn() } }));
vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  api: vi.fn(),
}));
const plan = {
  id: "plan-1",
  contractLineId: "line-1",
  frequency: "Quarterly",
  nextDueDate: "2030-01-31",
  version: 4,
} as MaintenancePlan;
const contract = {
  id: "agreement-1",
  version: 8,
  timeZoneId: "UTC",
  effectiveFromUtc: "2030-01-01T00:00:00Z",
  expiresAtUtc: "2031-01-01T00:00:00Z",
  lines: [{ id: "line-1", serviceType: "HVAC" }],
  visits: [
    {
      id: "visit-1",
      contractLineId: "line-1",
      dueDate: "2030-04-30",
      status: "Scheduled",
      workOrderId: "job-1",
    },
  ],
} as MaintenanceContract;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
  vi.mocked(api).mockReset().mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());
function show() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ContractPlanEditor
        contract={contract}
        plan={plan}
        sites={[{ id: "site-1", name: "Main site" }]}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText(/Change HVAC recurrence/));
  fireEvent.change(screen.getByLabelText(/^New plan service location/), {
    target: { value: "site-1" },
  });
  fireEvent.change(screen.getByLabelText(/^Recurrence change reason/), {
    target: { value: "Monthly inspections for the next maintenance period" },
  });
}

it("starts the new cadence after retained scheduled work and submits both concurrency versions", async () => {
  show();
  expect(screen.getByLabelText(/^First date in new cadence/)).toHaveValue(
    "2030-05-01",
  );
  fireEvent.change(screen.getByLabelText("New recurrence"), {
    target: { value: "Monthly" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save new recurrence" }));
  await waitFor(() => expect(api).toHaveBeenCalled());
  const [path, request] = vi.mocked(api).mock.calls[0];
  expect(path).toBe("/api/contracts/agreement-1/plans/plan-1");
  expect(request?.method).toBe("PUT");
  expect(JSON.parse(request?.body as string)).toMatchObject({
    expectedContractVersion: 8,
    expectedPlanVersion: 4,
    firstNewDue: "2030-05-01",
    frequency: "Monthly",
    serviceLocationId: "site-1",
  });
  expect(contract.visits[0].dueDate).toBe("2030-04-30");
});

it("keeps the operator's requested cadence when the server rejects a stale agreement", async () => {
  vi.mocked(api).mockRejectedValue(
    new Error("The agreement or maintenance plan changed; refresh and retry."),
  );
  show();
  fireEvent.change(screen.getByLabelText("New recurrence"), {
    target: { value: "Annual" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save new recurrence" }));
  expect(
    await screen.findByText(/agreement or maintenance plan changed/),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("New recurrence")).toHaveValue("Annual");
  expect(
    screen.getByRole("button", { name: "Save new recurrence" }),
  ).toBeEnabled();
});

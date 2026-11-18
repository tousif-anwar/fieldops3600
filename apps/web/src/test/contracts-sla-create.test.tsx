import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { Contracts } from "../pages/Contracts";
import { api, post } from "../api";
import type { MaintenanceContract } from "../contract-contracts";

vi.mock("../auth", () => ({
  manager: { getUser: vi.fn() },
  useAuth: () => ({ can: () => true }),
}));
vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  api: vi.fn(),
  post: vi.fn(),
}));

const customer = {
  id: "customer-1",
  displayName: "Synthetic SLA customer",
  teamId: "north",
  status: "Active",
  locations: [],
  contacts: [],
};
const agreement = {
  id: "agreement-1",
  customerId: customer.id,
  teamId: "north",
  status: "Draft",
  version: 1,
  effectiveFromUtc: "2026-01-01T00:00:00Z",
  expiresAtUtc: "2027-01-01T00:00:00Z",
  timeZoneId: "UTC",
  coversAllAssets: true,
  lines: [
    {
      id: "line-1",
      serviceType: "HVAC",
      active: true,
      includedVisits: 2,
      visitsUsed: 0,
      visitsRemaining: 2,
      partsUsed: 0,
      partsAllowance: 0,
    },
  ],
  coveredAssets: [],
  plans: [],
  visits: [],
  usage: [],
} as unknown as MaintenanceContract;
const active = { ...agreement, status: "Active", version: 3 };

beforeEach(() => {
  vi.mocked(api)
    .mockReset()
    .mockImplementation(async (path) => {
      if (path === "/api/customers/customer-1") return customer;
      if (path.startsWith("/api/customers"))
        return { items: [customer], total: 1, page: 1, pageSize: 100 };
      if (path === "/api/contracts/agreement-1") return active;
      if (path.endsWith("/renewals")) return [];
      if (path.startsWith("/api/contracts"))
        return { items: [], total: 0, page: 1, pageSize: 100 };
      return [];
    });
  vi.mocked(post)
    .mockReset()
    .mockImplementation(async (path) =>
      path === "/api/contracts"
        ? agreement
        : path.endsWith("/plans")
          ? { ...agreement, version: 2 }
          : active,
    );
});
async function show() {
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <Contracts />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  await screen.findByRole("option", { name: /Synthetic SLA customer/ });
  fireEvent.change(screen.getByLabelText(/^Customer/), {
    target: { value: customer.id },
  });
}
const create = () =>
  fireEvent.click(screen.getByRole("button", { name: "Create and activate" }));

it("creates an agreement with no implicit SLA origin or target numbers", async () => {
  await show();
  expect(screen.getByLabelText("Service target clock")).toHaveValue("");
  expect(screen.getByLabelText("Service starts within (minutes)")).toHaveValue(
    null,
  );
  expect(
    screen.getByLabelText("Service completes within (minutes)"),
  ).toHaveValue(null);
  create();
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/contracts",
      expect.objectContaining({
        slaClockOrigin: null,
        lines: [
          expect.objectContaining({
            responseTargetMinutes: null,
            completionTargetMinutes: null,
          }),
        ],
      }),
    ),
  );
  await screen.findByText(
    "Agreement created with a recurring plan and activated.",
  );
});

it("includes service targets only after the operator chooses the origin and elapsed minutes", async () => {
  await show();
  fireEvent.click(screen.getByText("Optional service targets"));
  fireEvent.change(screen.getByLabelText("Service target clock"), {
    target: { value: "AppointmentStart" },
  });
  fireEvent.change(screen.getByLabelText("Service starts within (minutes)"), {
    target: { value: "60" },
  });
  fireEvent.change(
    screen.getByLabelText("Service completes within (minutes)"),
    { target: { value: "240" } },
  );
  create();
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/contracts",
      expect.objectContaining({
        slaClockOrigin: "AppointmentStart",
        lines: [
          expect.objectContaining({
            responseTargetMinutes: 60,
            completionTargetMinutes: 240,
          }),
        ],
      }),
    ),
  );
  await screen.findByText(
    "Agreement created with a recurring plan and activated.",
  );
});

it("does not create a partial agreement when completion precedes the configured service start target", async () => {
  await show();
  fireEvent.click(screen.getByText("Optional service targets"));
  fireEvent.change(screen.getByLabelText("Service target clock"), {
    target: { value: "WorkOrderCreated" },
  });
  fireEvent.change(screen.getByLabelText("Service starts within (minutes)"), {
    target: { value: "60" },
  });
  fireEvent.change(
    screen.getByLabelText("Service completes within (minutes)"),
    { target: { value: "30" } },
  );
  create();
  expect(
    await screen.findByText(/service completion target must be at or after/),
  ).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});

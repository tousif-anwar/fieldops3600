import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CustomerPortal } from "../pages/CustomerPortal";
import { ServiceRequests } from "../pages/ServiceRequests";
import { Shell } from "../components/Shell";
import { api, post } from "../api";
import type {
  PortalAccount,
  ServiceRequest,
} from "../service-request-contracts";

const { identity } = vi.hoisted(() => ({
  identity: { roles: ["Customer"] as string[] },
}));
vi.mock("../auth", () => ({
  manager: { getUser: vi.fn() },
  useAuth: () => ({
    user: {
      profile: {
        sub: "customer-user",
        name: "Test Customer",
        team_id: "north",
        customer_id: "account-1",
      },
    },
    roles: identity.roles,
    can: (...roles: string[]) =>
      roles.some((role) => identity.roles.includes(role)),
    logout: vi.fn(),
  }),
}));
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  api: vi.fn(),
  post: vi.fn(),
}));

const account: PortalAccount = {
  id: "account-1",
  displayName: "Synthetic Company",
  customerType: "Commercial",
  status: "Active",
  teamId: "north",
  locations: [
    {
      id: "location-1",
      name: "Main office",
      addressLine1: "10 Test Street",
      city: "Test City",
      postalCode: "10000",
      countryCode: "US",
      status: "Active",
    },
    {
      id: "location-2",
      name: "Warehouse",
      addressLine1: "20 Example Road",
      city: "Test City",
      postalCode: "10000",
      countryCode: "US",
      status: "Active",
    },
  ],
};
const request: ServiceRequest = {
  id: "request-1",
  customerId: account.id,
  serviceLocationId: "location-1",
  title: "Cooling unit is not working",
  description: "The upstairs unit stopped cooling this morning.",
  serviceType: "Repair",
  urgency: "Routine",
  status: "Submitted",
  version: 2,
  createdAtUtc: "2026-11-13T15:00:00Z",
  updatedAtUtc: "2026-11-13T15:00:00Z",
  customerName: account.displayName,
  siteAddress: "10 Test Street",
};

beforeEach(() => {
  identity.roles = ["Customer"];
  vi.mocked(post).mockReset();
  vi.mocked(api)
    .mockReset()
    .mockImplementation(async (path) => {
      if (path === "/api/customer-portal/account") return account;
      if (path === "/api/customer-portal/equipment")
        return [
          {
            id: "asset-1",
            name: "Office rooftop",
            model: "RT-1",
            serialNumber: "TEST-1",
            manufacturer: "Synthetic",
            serviceLocationId: "location-1",
            status: "Active",
          },
          {
            id: "asset-2",
            name: "Warehouse unit",
            model: "RT-2",
            serialNumber: "TEST-2",
            manufacturer: "Synthetic",
            serviceLocationId: "location-2",
            status: "Active",
          },
        ];
      if (path === "/api/service-requests") return [request];
      return [];
    });
});

function mount(children: React.ReactNode) {
  render(
    <MemoryRouter initialEntries={["/portal"]}>
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false },
              mutations: { retry: false },
            },
          })
        }
      >
        {children}
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("customer portal", () => {
  it("uses scoped customer resources and excludes operational navigation and queries", async () => {
    mount(
      <Routes>
        <Route element={<Shell />}>
          <Route path="portal" element={<CustomerPortal />} />
        </Route>
      </Routes>,
    );
    await screen.findByRole("heading", { name: "Synthetic Company" });
    expect(
      screen.getByRole("link", { name: "Customer portal" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Work orders" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "All workspaces" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    const paths = vi.mocked(api).mock.calls.map(([path]) => path);
    expect(paths).toContain("/api/customer-portal/account");
    expect(paths).not.toContain("/api/work-orders");
    expect(paths).not.toContain("/api/notifications");
    expect(paths).not.toContain("/api/technicians");
  });

  it("submits a request without client-selected identity or a promised appointment", async () => {
    vi.mocked(post).mockResolvedValue(request);
    mount(<CustomerPortal />);
    await screen.findByRole("heading", { name: "Synthetic Company" });
    await userEvent.selectOptions(
      screen.getByLabelText("Service location", { exact: false }),
      "location-1",
    );
    expect(
      screen.getByRole("option", { name: /Office rooftop/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Warehouse unit/ }),
    ).not.toBeInTheDocument();
    await userEvent.selectOptions(
      screen.getByLabelText("Equipment", { exact: true }),
      "asset-1",
    );
    await userEvent.type(
      screen.getByLabelText("Request title", { exact: false }),
      request.title,
    );
    await userEvent.type(
      screen.getByLabelText("Describe the problem", { exact: false }),
      request.description,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Submit service request" }),
    );
    await screen.findByText(
      "Service request received for review. Your appointment will appear here once scheduling is confirmed.",
    );
    expect(post).toHaveBeenCalledWith("/api/service-requests", {
      serviceLocationId: "location-1",
      assetId: "asset-1",
      title: request.title,
      description: request.description,
      serviceType: "Repair",
      urgency: "Routine",
      idempotencyKey: expect.any(String),
    });
    expect(screen.getByText("No confirmed appointment")).toBeInTheDocument();
  });

  it("preserves request content and key on a failed submission and retry", async () => {
    vi.mocked(post)
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValue(request);
    mount(<CustomerPortal />);
    await screen.findByRole("heading", { name: "Synthetic Company" });
    await userEvent.selectOptions(
      screen.getByLabelText("Service location", { exact: false }),
      "location-1",
    );
    await userEvent.type(
      screen.getByLabelText("Request title", { exact: false }),
      request.title,
    );
    await userEvent.type(
      screen.getByLabelText("Describe the problem", { exact: false }),
      request.description,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Submit service request" }),
    );
    await screen.findByText(/Network unavailable/);
    expect(
      screen.getByLabelText("Describe the problem", { exact: false }),
    ).toHaveValue(request.description);
    await userEvent.click(
      screen.getByRole("button", { name: "Submit service request" }),
    );
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(vi.mocked(post).mock.calls[0][1]).toEqual(
      vi.mocked(post).mock.calls[1][1],
    );
  });
});

describe("dispatcher qualification", () => {
  it("records a versioned decision before scheduling and exposes server conflicts", async () => {
    identity.roles = ["Dispatcher"];
    vi.mocked(post).mockRejectedValue(
      new Error("This request was already reviewed."),
    );
    mount(<ServiceRequests />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Review request" }),
    );
    await userEvent.type(
      screen.getByLabelText("Decision reason", { exact: false }),
      "Reported failure requires a diagnostic visit",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Create work order" }),
    );
    await screen.findByText(/This request was already reviewed/);
    expect(post).toHaveBeenCalledWith(
      "/api/service-requests/request-1/qualify",
      expect.objectContaining({
        expectedVersion: 2,
        decision: "Approve",
        serviceCategory: "HVAC",
        priority: "Normal",
      }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByText("Booking confirmed")).not.toBeInTheDocument();
  });
});

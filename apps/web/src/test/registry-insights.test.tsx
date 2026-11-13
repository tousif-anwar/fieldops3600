import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../api";
import { RegistryInsights } from "../pages/RegistryInsights";

vi.mock("../api", () => ({
  api: vi.fn(),
  ApiError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

const customers = {
  registeredCustomers: 7,
  activeCustomers: 5,
  archivedCustomers: 2,
  contactCount: 11,
  locationCount: 9,
  activeLocationCount: 8,
  emailConsentCount: 3,
  phoneConsentCount: 4,
  linkedWorkOrders: 13,
  unregisteredWorkOrders: 6,
  pendingCustomerVersions: 1,
  refreshedAtUtc: null,
  breakdown: [],
};
const assets = {
  registeredAssets: 17,
  activeAssets: 12,
  inactiveAssets: 3,
  retiredAssets: 2,
  warrantyExpiring90Days: 4,
  customersWithAssets: 5,
  linkedWorkOrders: 9,
  pendingAssetVersions: 2,
  refreshedAtUtc: null,
  byType: [],
};

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RegistryInsights />
    </QueryClientProvider>,
  );
}

function figure(label: string) {
  return within(screen.getByText(label, { exact: true }).parentElement!);
}

describe("customer and asset warehouse registry reporting", () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === "/api/reports/customers") return customers as never;
      if (path === "/api/reports/assets") return assets as never;
      throw new Error(`Unexpected report endpoint: ${path}`);
    });
  });

  it("keeps customer, contact consent and explicitly linked equipment populations distinct", async () => {
    mount();
    await screen.findByText("Registered customers");
    expect(figure("Registered customers").getByText("7")).toBeVisible();
    expect(figure("Contacts").getByText("11")).toBeVisible();
    expect(figure("Contacts with email consent").getByText("3")).toBeVisible();
    expect(figure("Contacts with phone consent").getByText("4")).toBeVisible();
    expect(figure("Registered assets").getByText("17")).toBeVisible();
    expect(figure("Linked work orders").getByText("13")).toBeVisible();
    expect(
      figure("Explicitly linked work orders").getByText("9"),
    ).toBeVisible();
    expect(screen.getByText(/Awaiting customer events/)).toBeVisible();
    expect(screen.getByText(/Awaiting asset events/)).toBeVisible();
    expect(
      screen.getByText(/Consent measures count contacts, not customers/),
    ).toBeVisible();
    expect(screen.getByText(/Customer-only orders are excluded/)).toBeVisible();
  });

  it("shows one unavailable analytical subject without hiding the successful subject or inventing counts", async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === "/api/reports/customers")
        throw new Error("Customer projection unavailable");
      return assets as never;
    });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Customer projection unavailable",
    );
    expect(figure("Registered assets").getByText("17")).toBeVisible();
    expect(
      screen.queryByText("Registered customers", { exact: true }),
    ).not.toBeInTheDocument();
  });

  it("refreshes both persisted subjects and displays an actual changed source count", async () => {
    mount();
    await screen.findByText("Registered customers");
    vi.mocked(api).mockImplementation(async (path) =>
      path === "/api/reports/customers"
        ? ({ ...customers, registeredCustomers: 8 } as never)
        : ({ ...assets, registeredAssets: 18 } as never),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Refresh registry metrics" }),
    );
    expect(await figure("Registered customers").findByText("8")).toBeVisible();
    expect(await figure("Registered assets").findByText("18")).toBeVisible();
    expect(
      vi
        .mocked(api)
        .mock.calls.filter(([path]) => path === "/api/reports/customers"),
    ).toHaveLength(2);
    expect(
      vi
        .mocked(api)
        .mock.calls.filter(([path]) => path === "/api/reports/assets"),
    ).toHaveLength(2);
  });
});

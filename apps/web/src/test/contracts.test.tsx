import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../api";
import { Contracts } from "../pages/Contracts";

vi.mock("../auth", () => ({
  manager: { getUser: vi.fn() },
  useAuth: () => ({
    can: (...roles: string[]) => roles.includes("OperationsManager"),
  }),
}));
vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  api: vi.fn(),
  post: vi.fn(),
}));

const customer = {
  id: "customer-1",
  displayName: "Northwind Tower",
  customerType: "Commercial",
  teamId: "north",
  status: "Active",
  preferredChannel: "Email",
  version: 1,
  createdAtUtc: "2026-01-01T00:00:00Z",
  updatedAtUtc: "2026-01-01T00:00:00Z",
  contacts: [],
  locations: [],
};

beforeEach(() => {
  vi.mocked(api).mockReset().mockImplementation(async (path) => {
    if (path.startsWith("/api/customers")) {
      return { items: [customer], total: 1, page: 1, pageSize: 100 };
    }
    if (path.startsWith("/api/contracts")) {
      return {
        items: [
          {
            id: "contract-1",
            customerId: customer.id,
            status: "Active",
            effectiveFromUtc: "2026-01-01T00:00:00Z",
            expiresAtUtc: "2027-01-01T00:00:00Z",
            version: 2,
            lineCount: 1,
            visitCount: 4,
            nextVisit: "2026-04-01",
          },
        ],
        total: 1,
        page: 1,
        pageSize: 100,
      };
    }
    return [];
  });
});

describe("maintenance agreements", () => {
  it("shows authorized agreements and the active coverage workflow", async () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <Contracts />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Northwind Tower")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create and activate" })).toBeInTheDocument();
    expect(screen.getByText("Next visit")).toBeInTheDocument();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError, api } from "../api";
import { Inventory } from "../pages/Inventory";
import {
  InventoryCommandForm,
  emptyInventoryDraft,
} from "../components/InventoryCommandForm";
import {
  inventoryCommand,
  quantityValue,
  type InventoryPart,
  type StockLocation,
} from "../inventory-contracts";

const { identity } = vi.hoisted(() => ({
  identity: { roles: ["OperationsManager"] as string[] },
}));
vi.mock("../auth", () => ({
  manager: { getUser: vi.fn() },
  useAuth: () => ({
    can: (...roles: string[]) =>
      roles.some((role) => identity.roles.includes(role)),
  }),
}));
vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  api: vi.fn(),
  post: vi.fn(),
}));

const part: InventoryPart = {
  id: "part-1",
  teamId: "north",
  sku: "FILTER",
  name: "Air filter",
  category: "Filters",
  unit: "Each",
  currency: "USD",
  unitCost: 1.2345,
  reorderPoint: 5,
  reorderQuantity: 10,
  active: true,
  version: 1,
};
const location: StockLocation = {
  id: "warehouse-1",
  teamId: "north",
  name: "North warehouse",
  kind: "CentralWarehouse",
  active: true,
  version: 1,
};
function mount(children: React.ReactNode) {
  return render(
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
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  identity.roles = ["OperationsManager"];
  vi.mocked(api)
    .mockReset()
    .mockImplementation(async (path) => {
      if (path === "/api/inventory/parts") return [part];
      if (path === "/api/inventory/locations") return [location];
      if (path === "/api/inventory/balances")
        return [
          {
            partId: part.id,
            locationId: location.id,
            partName: part.name,
            sku: part.sku,
            locationName: location.name,
            onHand: 12,
            reserved: 8,
            available: 4,
            belowReorderPoint: true,
            version: 2,
          },
        ];
      return [];
    });
});

describe("inventory actions", () => {
  it("rejects invalid precision and same-location transfers before sending a command", () => {
    for (const value of ["0", "-1", "1.0001", "1e2", "NaN", "Infinity"])
      expect(() => quantityValue(value)).toThrow();
    expect(quantityValue("1.125")).toBe(1.125);
    expect(quantityValue("-2.5", true)).toBe(-2.5);
    expect(() =>
      inventoryCommand(
        {
          ...emptyInventoryDraft,
          action: "transfer",
          partId: part.id,
          locationId: location.id,
          destinationLocationId: location.id,
          quantity: "1",
        },
        "operation-1",
      ),
    ).toThrow("different destination");
  });
  it("does not require an unrelated quantity when closing a request", () => {
    expect(
      inventoryCommand(
        {
          ...emptyInventoryDraft,
          action: "close",
          recordId: "request-1",
          reason: "Stock supplied",
        },
        "operation-1",
      ),
    ).toEqual({
      path: "/requests/request-1/close",
      body: { operationId: "operation-1", reason: "Stock supplied" },
    });
  });
  it("refreshes after a stock conflict and retries unchanged input with the original operation key", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, "Available stock changed."))
      .mockResolvedValueOnce({});
    const refresh = vi.fn().mockResolvedValue(undefined);
    mount(
      <InventoryCommandForm
        actions={["receive"]}
        parts={[part]}
        locations={[location]}
        orders={[]}
        transfers={[]}
        workOrderId=""
        online
        submit={submit}
        refresh={refresh}
      />,
    );
    await userEvent.selectOptions(
      screen.getByLabelText("Part", { exact: false }),
      part.id,
    );
    await userEvent.selectOptions(
      screen.getByLabelText("Stock location", { exact: false }),
      location.id,
    );
    await userEvent.type(
      screen.getByLabelText("Quantity", { exact: false }),
      "2",
    );
    await userEvent.type(
      screen.getByLabelText("Reason", { exact: false }),
      "Stock received",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Receive stock" }),
    );
    expect(
      await screen.findByText(/Available stock changed/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Quantity", { exact: false })).toHaveValue(
      "2",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Refresh inventory" }),
    );
    expect(refresh).toHaveBeenCalledOnce();
    await userEvent.click(
      screen.getByRole("button", { name: "Receive stock" }),
    );
    await screen.findByText("Inventory change recorded.");
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
  });
  it("blocks mutations while offline without consuming the submit operation", async () => {
    const submit = vi.fn();
    mount(
      <InventoryCommandForm
        actions={["receive"]}
        parts={[part]}
        locations={[location]}
        orders={[]}
        transfers={[]}
        workOrderId=""
        online={false}
        submit={submit}
        refresh={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Receive stock" }),
    ).toBeDisabled();
    expect(screen.getByText(/not queued offline/)).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });
  it("renders authoritative balance fields and does not offer dispatcher stock adjustments", async () => {
    identity.roles = ["Dispatcher"];
    mount(<Inventory />);
    await screen.findByText("Below reorder point");
    expect(screen.getByRole("cell", { name: "12" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "8" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "4" })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "Request parts" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("option", { name: "Adjust stock" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Register a part")).not.toBeInTheDocument();
  });
});

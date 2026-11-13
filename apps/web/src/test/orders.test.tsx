import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CreateOrder } from "../pages/WorkOrders";
import { api, post } from "../api";

vi.mock("../auth", () => ({
  useAuth: () => ({
    user: { profile: { sub: "dispatcher-01", team_id: "north" } },
    can: () => true,
  }),
}));
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, api: vi.fn(), post: vi.fn() };
});
describe("work order creation", () => {
  beforeEach(() => {
    vi.mocked(post).mockReset();
    vi.mocked(api)
      .mockReset()
      .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });
  });
  const useUnregisteredCustomer = async (
    reason = "Legacy account pending registration",
  ) => {
    await userEvent.click(
      screen.getByRole("checkbox", {
        name: /unregistered customer exception/i,
      }),
    );
    await userEvent.type(
      screen.getByLabelText(/Unregistered customer reason/),
      reason,
    );
  };
  const mount = () =>
    render(
      <MemoryRouter>
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { mutations: { retry: false } } })
          }
        >
          <CreateOrder />
        </QueryClientProvider>
      </MemoryRouter>,
    );
  it("blocks invalid work orders before any API mutation", async () => {
    mount();
    await useUnregisteredCustomer();
    await userEvent.click(
      screen.getByRole("button", { name: "Create work order" }),
    );
    await screen.findByText("Add a title with at least five characters.");
    expect(post).not.toHaveBeenCalled();
  });
  it("submits validated service details with authenticated team scope", async () => {
    vi.mocked(post).mockResolvedValue({ id: "new-work-order" });
    mount();
    await useUnregisteredCustomer();
    await userEvent.type(
      screen.getByLabelText(/Work order title/),
      "Rooftop unit not cooling",
    );
    await userEvent.type(
      screen.getByLabelText(/Customer name/),
      "Synthetic Customer",
    );
    await userEvent.type(
      screen.getByLabelText(/Service address/),
      "123 Example Street",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Create work order" }),
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/work-orders",
        expect.objectContaining({
          title: "Rooftop unit not cooling",
          customerName: "Synthetic Customer",
          siteAddress: "123 Example Street",
          teamId: "north",
          priority: "Normal",
        }),
      ),
    );
  });
  it("preserves the form and displays a real server rejection", async () => {
    vi.mocked(post).mockImplementation(async () => {
      throw new Error("Team is not authorized.");
    });
    mount();
    await useUnregisteredCustomer();
    await userEvent.type(
      screen.getByLabelText(/Work order title/),
      "Rooftop unit not cooling",
    );
    await userEvent.type(
      screen.getByLabelText(/Customer name/),
      "Synthetic Customer",
    );
    await userEvent.type(
      screen.getByLabelText(/Service address/),
      "123 Example Street",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Create work order" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Team is not authorized.",
    );
    expect(screen.getByLabelText(/Work order title/)).toHaveValue(
      "Rooftop unit not cooling",
    );
  });
});

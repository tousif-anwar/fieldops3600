import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Notifications } from "../pages/Notifications";
import { api, post } from "../api";
import type { Notification } from "../types";

vi.mock("../api", () => ({ api: vi.fn(), post: vi.fn() }));
const alerts: Notification[] = Array.from({ length: 21 }, (_, index) => ({
  id: `alert-${index + 1}`,
  workOrderId: `order-${index + 1}`,
  title: `Synthetic alert ${index + 1}`,
  createdAtUtc: "2026-11-14T14:00:00Z",
}));
function mount() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, retry: false, gcTime: 0 },
    },
  });
  client.setQueryData(["notifications"], alerts);
  render(
    <QueryClientProvider client={client}>
      <Notifications />
    </QueryClientProvider>,
  );
  return client;
}

describe("paginated operational lists", () => {
  beforeEach(() => {
    vi.mocked(api).mockReset().mockResolvedValue(alerts);
    vi.mocked(post).mockReset().mockResolvedValue({});
  });
  it("reaches and acknowledges a notification beyond the first page without showing all records at once", async () => {
    mount();
    expect(screen.getAllByRole("article")).toHaveLength(20);
    expect(screen.queryByText("Synthetic alert 21")).not.toBeInTheDocument();
    const pages = screen.getByRole("navigation", {
      name: "Notifications pages",
    });
    expect(
      within(pages).getByRole("button", { name: "Previous" }),
    ).toBeDisabled();
    fireEvent.click(within(pages).getByRole("button", { name: "Next" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Synthetic alert 21")).toBeVisible();
    expect(within(pages).getByRole("button", { name: "Next" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/notifications/alert-21/acknowledge",
        {},
      ),
    );
    fireEvent.click(within(pages).getByRole("button", { name: "Previous" }));
    expect(await screen.findByText("Synthetic alert 1")).toBeVisible();
  });
  it("keeps visible records reachable when a refresh shrinks the current page", async () => {
    const client = mount();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Synthetic alert 21")).toBeVisible();
    await act(async () => {
      client.setQueryData(["notifications"], alerts.slice(0, 1));
    });
    expect(await screen.findByText("Synthetic alert 1")).toBeVisible();
    expect(
      screen.queryByRole("navigation", { name: "Notifications pages" }),
    ).not.toBeInTheDocument();
  });
});

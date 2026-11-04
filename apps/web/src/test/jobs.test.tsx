import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { MyJobs } from "../pages/Workflow";
import type { Workflow, WorkOrder } from "../types";

vi.mock("../auth", () => ({
  useAuth: () => ({
    can: () => true,
    user: { profile: { sub: "supervisor-01" } },
  }),
}));
vi.mock("../api", () => ({ api: vi.fn(), post: vi.fn() }));

const order: WorkOrder = {
  id: "order-1",
  number: "WO-TEST",
  title: "Synthetic completed service",
  customerName: "Synthetic customer",
  siteAddress: "100 Example Street",
  serviceCategory: "HVAC",
  priority: "Normal",
  status: "Completed",
  teamId: "north",
  technicianId: "tech-01",
  createdAtUtc: "2026-11-04T13:00:00Z",
  version: 1,
};
function renderJob(status: string, stageStatuses: string[]) {
  const workflow: Workflow = {
    id: "workflow-1",
    workOrderId: order.id,
    technicianId: "tech-01",
    teamId: "north",
    templateVersion: 1,
    currentStageIndex: 7,
    version: 9,
    status,
    stages: stageStatuses.map((stageStatus, index) => ({
      id: `stage-${index}`,
      index,
      name: `Stage ${index + 1}`,
      status: stageStatus,
      pausedSeconds: 0,
      slaStatus: "OnTime",
      answers: {},
    })),
  };
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity } },
  });
  client.setQueryData(["work-orders"], [order]);
  client.setQueryData(["workflows"], [workflow]);
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <MyJobs />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
describe("recorded workflow progress", () => {
  it("displays all eight stages complete when the terminal workflow retains final index seven", () => {
    renderJob("Completed", [
      "Completed",
      "Completed",
      "Completed",
      "Completed",
      "Completed",
      "Completed",
      "Completed",
      "Active",
    ]);
    expect(screen.getByText("8/8 stages")).toBeVisible();
    const progress = screen.getByRole("progressbar", {
      name: "WO-TEST workflow completion",
    });
    expect(progress).toHaveAttribute("aria-valuenow", "8");
    expect(progress.firstElementChild).toHaveStyle({ width: "100%" });
    expect(
      screen.getByRole("button", { name: "Review service" }),
    ).toBeVisible();
  });
  it("counts completed and overridden outcomes rather than using the current index as completed work", () => {
    renderJob("Active", [
      "Completed",
      "Overridden",
      "Pending",
      "Pending",
      "Pending",
      "Pending",
      "Pending",
      "Active",
    ]);
    expect(screen.getByText("2/8 stages")).toBeVisible();
    const progress = screen.getByRole("progressbar", {
      name: "WO-TEST workflow completion",
    });
    expect(progress).toHaveAttribute("aria-valuenow", "2");
    expect(progress.firstElementChild).toHaveStyle({ width: "25%" });
  });
});

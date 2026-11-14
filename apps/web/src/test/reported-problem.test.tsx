import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { OrderDetails } from "../pages/WorkOrders";
import { WorkflowPage } from "../pages/Workflow";
import type { WorkOrder, Workflow } from "../types";

vi.mock("../auth", () => ({
  useAuth: () => ({ can: () => true, user: { profile: { sub: "tech-01" } } }),
}));
vi.mock("../api", () => ({ api: vi.fn(), post: vi.fn() }));

const problem =
  "Office unit reports fault E7.\nCustomer note: <script>example</script>";
const order: WorkOrder = {
  id: "order-1",
  number: "WO-TEST",
  title: "Cooling diagnostic",
  reportedProblem: problem,
  customerName: "Synthetic Customer",
  siteAddress: "100 Example Street",
  serviceCategory: "HVAC",
  priority: "Normal",
  status: "Scheduled",
  teamId: "north",
  technicianId: "tech-01",
  createdAtUtc: "2026-11-14T05:00:00Z",
  version: 1,
};
const workflow: Workflow = {
  id: "workflow-1",
  workOrderId: order.id,
  technicianId: "tech-01",
  teamId: "north",
  templateVersion: 1,
  currentStageIndex: 0,
  version: 1,
  status: "Active",
  stages: [
    {
      id: "stage-1",
      index: 0,
      name: "Job Accepted",
      status: "Active",
      pausedSeconds: 0,
      slaStatus: "OnTime",
      answers: {},
    },
  ],
};

function mount(view: "detail" | "workflow", item = order) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(["work-order", item.id], item);
  client.setQueryData(["workflows", item.id], []);
  client.setQueryData(["workflow", workflow.id], workflow);
  client.setQueryData(["workflow-template", 1], {
    version: 1,
    stages: [{ index: 0, name: "Job Accepted", fields: [] }],
  });
  return render(
    <MemoryRouter
      initialEntries={[
        view === "detail" ? "/work-orders/order-1" : "/workflow/workflow-1",
      ]}
    >
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="work-orders/:id" element={<OrderDetails />} />
          <Route path="workflow/:id" element={<WorkflowPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("customer-reported problem handoff", () => {
  it.each(["detail", "workflow"] as const)(
    "keeps the full customer description visible as plain multiline text in %s",
    (view) => {
      const { container } = mount(view);
      expect(
        screen.getByText(problem, { normalizer: (value) => value }),
      ).toHaveClass("portal-notes");
      expect(container.querySelector("script")).toBeNull();
    },
  );
  it("uses the existing title for legacy manual orders without reported problem text", () => {
    mount("detail", { ...order, reportedProblem: "" });
    expect(screen.getByText(order.title, { selector: "dd" })).toBeVisible();
  });
});

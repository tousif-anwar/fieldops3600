import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowPage } from "../pages/Workflow";
import { api, post } from "../api";
import type { Template, Workflow, WorkOrder } from "../types";

vi.mock("../auth", () => ({
  useAuth: () => ({ can: () => true, user: { profile: { sub: "tech-01" } } }),
}));
vi.mock("../api", () => ({ api: vi.fn(), post: vi.fn() }));
const order: WorkOrder = {
  id: "order-1",
  number: "WO-DRAFT",
  title: "Synthetic draft retention",
  customerName: "Synthetic customer",
  siteAddress: "100 Example Street",
  teamId: "north",
  technicianId: "tech-01",
  serviceCategory: "HVAC",
  priority: "Normal",
  status: "InProgress",
  createdAtUtc: "2026-11-14T14:00:00Z",
  version: 1,
};
const workflow: Workflow = {
  id: "workflow-1",
  workOrderId: order.id,
  technicianId: "tech-01",
  teamId: "north",
  templateVersion: 2,
  currentStageIndex: 1,
  version: 1,
  status: "Active",
  stages: [
    {
      id: "stage-0",
      index: 0,
      name: "Review",
      status: "Completed",
      pausedSeconds: 0,
      slaStatus: "OnTime",
      answers: { notes: "Previously recorded findings" },
    },
    {
      id: "stage-1",
      index: 1,
      name: "Service",
      status: "Active",
      pausedSeconds: 0,
      slaStatus: "OnTime",
      deadlineUtc: "2030-11-14T16:00:00Z",
      answers: {},
    },
  ],
};
const template: Template = {
  version: 2,
  stages: workflow.stages.map((stage) => ({
    index: stage.index,
    name: stage.name,
    fields: [
      {
        key: "notes",
        label: "Service notes",
        options: [],
        inputType: "text",
        required: true,
        maxLength: 500,
      },
    ],
  })),
};
function mount() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, retry: false, gcTime: 0 },
    },
  });
  client.setQueryData(["workflow", workflow.id], workflow);
  client.setQueryData(["workflow-template", 2], template);
  client.setQueryData(["work-order", order.id], order);
  render(
    <MemoryRouter initialEntries={[`/workflow/${workflow.id}`]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/workflow/:id" element={<WorkflowPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return client;
}

describe("field service draft continuity", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(api).mockReset();
    vi.mocked(post)
      .mockReset()
      .mockResolvedValue({ ...workflow, version: 3 });
  });
  it("preserves unsent notes across SLA polling and submits the latest authoritative version", async () => {
    const client = mount();
    const notes = await screen.findByRole("textbox", { name: /Service notes/ });
    fireEvent.change(notes, {
      target: { value: "Unsent technician diagnosis" },
    });
    await act(async () => {
      client.setQueryData(["workflow", workflow.id], {
        ...workflow,
        version: 2,
        stages: workflow.stages.map((stage) => ({
          ...stage,
          deadlineUtc: "2030-11-14T16:20:00Z",
        })),
      });
    });
    await waitFor(() =>
      expect(notes).toHaveValue("Unsent technician diagnosis"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit & continue" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        `/api/workflows/${workflow.id}/submit`,
        expect.objectContaining({
          expectedVersion: 2,
          answers: { notes: "Unsent technician diagnosis" },
        }),
      ),
    );
  });
  it("shows recorded answers when switching to read-only history and restores the active draft on return", async () => {
    mount();
    fireEvent.change(
      await screen.findByRole("textbox", { name: /Service notes/ }),
      { target: { value: "Saved current-stage draft" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    fireEvent.click(screen.getByRole("button", { name: /Review.*Completed/i }));
    expect(
      await screen.findByRole("textbox", { name: /Service notes/ }),
    ).toHaveValue("Previously recorded findings");
    expect(
      screen.getByRole("textbox", { name: /Service notes/ }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: /Service.*Current stage/i }),
    );
    expect(
      await screen.findByRole("textbox", { name: /Service notes/ }),
    ).toHaveValue("Saved current-stage draft");
  });
});

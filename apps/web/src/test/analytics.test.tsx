import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Analytics } from "../pages/Analytics";
import { api, download } from "../api";
import { percent } from "../format";
import type { Reports } from "../types";

vi.mock("../api", () => ({ api: vi.fn(), download: vi.fn() }));
// These cases verify the real metric/table/filter behavior; chart painting is
// covered separately by browser checks and is outside the nullable-data boundary.
vi.mock("recharts", () =>
  Object.fromEntries(
    [
      "Area",
      "AreaChart",
      "Bar",
      "BarChart",
      "CartesianGrid",
      "Legend",
      "ResponsiveContainer",
      "Tooltip",
      "XAxis",
      "YAxis",
    ].map((name) => [name, () => null]),
  ),
);

function emptyReport(): Reports {
  return {
    totalWorkOrders: 0,
    completedWorkOrders: 0,
    completionRate: null,
    slaComplianceRate: null,
    averageServiceMinutes: null,
    averageStageMinutes: null,
    activeJobs: 0,
    atRiskStages: 0,
    overdueStages: 0,
    completedToday: 0,
    escalationFrequency: null,
    schedulingEfficiency: null,
    slaComplianceTrend: [],
    stageDurationDistribution: [],
    stageDurationSampleCount: 0,
    supervisorInterventionTrend: [],
    refreshedAtUtc: null,
    volumeTrend: [],
    stageMetrics: [],
    categoryBreakdown: [],
    technicianUtilization: [],
  };
}
function mount(report: Reports) {
  vi.mocked(api).mockResolvedValue(report);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Analytics />
    </QueryClientProvider>,
  );
}
const metric = (label: string) =>
  within(screen.getByText(label, { exact: true }).closest("article")!);

describe("warehouse metric availability", () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(download).mockReset();
    vi.mocked(download).mockResolvedValue(undefined);
  });

  it("renders an empty all-null analytical population without inventing zero rates or durations", async () => {
    mount(emptyReport());
    await screen.findByText("Total work orders");
    expect(
      metric("Total work orders").getByText("0", { exact: true }),
    ).toBeVisible();
    for (const label of [
      "Completion rate",
      "SLA compliance",
      "Average stage time",
    ])
      expect(metric(label).getByText("—", { exact: true })).toBeVisible();
    expect(screen.getByText("Awaiting ingestion")).toBeVisible();
    expect(screen.queryByText("0.0%", { exact: true })).not.toBeInTheDocument();
    expect(
      screen.getByText(/unknown durations or capacity display unavailable/),
    ).toBeVisible();
  });

  it("retains unknown stage duration and utilization without painting a zero-width capacity bar", async () => {
    const report = emptyReport();
    report.stageMetrics = [
      { stage: "Diagnosis", averageMinutes: null, breaches: 0, count: 1 },
    ];
    report.technicianUtilization = [
      {
        technicianId: "tech-01",
        bookedMinutes: 90,
        capacityMinutes: null,
        utilization: null,
      },
    ];
    const { container } = mount(report);
    await screen.findByText("Total work orders");
    expect(
      within(screen.getByRole("row", { name: /Diagnosis/ })).getByText(
        "Not available",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      screen.getByText("Utilization not available for this interval."),
    ).toBeVisible();
    expect(screen.getByText("90 booked minutes")).toBeVisible();
    expect(
      container.querySelector(".utilization-track"),
    ).not.toBeInTheDocument();
  });

  it("preserves known zero metrics and formats API percentages as ratios", async () => {
    const report = {
      ...emptyReport(),
      totalWorkOrders: 1,
      completionRate: 0,
      slaComplianceRate: 0,
      averageStageMinutes: 0,
      averageServiceMinutes: 0,
    };
    report.stageMetrics = [
      { stage: "Diagnosis", averageMinutes: 0, breaches: 0, count: 1 },
    ];
    report.technicianUtilization = [
      {
        technicianId: "tech-01",
        bookedMinutes: 0,
        capacityMinutes: 480,
        utilization: 0,
      },
    ];
    const { container } = mount(report);
    await screen.findByText("Total work orders");
    expect(
      metric("Completion rate").getByText("0.0%", { exact: true }),
    ).toBeVisible();
    expect(
      metric("SLA compliance").getByText("0.0%", { exact: true }),
    ).toBeVisible();
    expect(
      within(screen.getByRole("row", { name: /Diagnosis/ })).getByText("0.00", {
        exact: true,
      }),
    ).toBeVisible();
    expect(container.querySelector(".utilization-track span")).toHaveStyle({
      width: "0%",
    });
    expect(percent(null)).toBe("—");
    expect(percent(1.25)).toBe("125.0%");
  });

  it.each(["2026-11-04", "2026-03-08", "2026-11-01"])(
    "uses next local midnight as the exclusive through-date boundary for %s, including exports",
    async (date) => {
      mount(emptyReport());
      await screen.findByText("Total work orders");
      fireEvent.change(screen.getByLabelText("Through date"), {
        target: { value: date },
      });
      await waitFor(() =>
        expect(vi.mocked(api).mock.calls.at(-1)?.[0]).toContain("to="),
      );
      const query = new URL(
        vi.mocked(api).mock.calls.at(-1)![0],
        "http://fieldops.test",
      ).searchParams;
      const boundary = new Date(query.get("to")!);
      const selected = new Date(`${date}T00:00:00`);
      selected.setDate(selected.getDate() + 1);
      expect(boundary.getTime()).toBe(selected.getTime());
      expect([
        boundary.getHours(),
        boundary.getMinutes(),
        boundary.getSeconds(),
        boundary.getMilliseconds(),
      ]).toEqual([0, 0, 0, 0]);
      await userEvent.click(screen.getByRole("button", { name: "Export CSV" }));
      const exportQuery = new URL(
        vi.mocked(download).mock.calls[0][0],
        "http://fieldops.test",
      ).searchParams;
      expect(exportQuery.get("to")).toBe(query.get("to"));
    },
  );
});

describe("warehouse pattern views", () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
  });

  const patternReport = (): Reports => ({
    ...emptyReport(),
    totalWorkOrders: 3,
    slaComplianceTrend: [
      {
        date: "2026-11-03",
        completedStages: 4,
        compliantStages: 3,
        breachedStages: 1,
        complianceRate: 0.75,
      },
      {
        date: "2026-11-04",
        completedStages: 2,
        compliantStages: 1,
        breachedStages: 1,
        complianceRate: null,
      },
    ],
    stageDurationDistribution: [
      { bucket: "0–<10", lowerMinutes: 0, upperMinutes: 10, count: 0 },
      { bucket: "10–<20", lowerMinutes: 10, upperMinutes: 20, count: 0 },
    ],
    supervisorInterventionTrend: [],
  });

  it("shows an unknown compliance rate as unavailable instead of a fabricated zero", async () => {
    mount(patternReport());
    await screen.findByRole("tab", { name: "SLA trend" });
    expect(screen.getByText("View source figures")).toBeInTheDocument();
    const observed = screen.getByRole("row", { name: /2026-11-03/ });
    expect(observed).toHaveTextContent("75.0%");
    expect(observed).toHaveTextContent("3");
    const unknown = screen.getByRole("row", { name: /2026-11-04/ });
    expect(unknown).toHaveTextContent("Not available");
    expect(unknown).not.toHaveTextContent("0.0%");
  });

  it("does not present an all-zero histogram as a measured duration distribution", async () => {
    mount(patternReport());
    const tab = await screen.findByRole("tab", { name: "Stage durations" });
    await userEvent.click(tab);
    expect(
      await screen.findByText("No known stage-duration samples"),
    ).toBeVisible();
    expect(
      screen.queryByRole("img", { name: /stage-duration histogram/ }),
    ).not.toBeInTheDocument();
  });

  it("reports an empty supervisor action population without inventing actions", async () => {
    mount(patternReport());
    const tab = await screen.findByRole("tab", { name: "Supervisor actions" });
    await userEvent.click(tab);
    expect(
      await screen.findByText("No recorded supervisor actions"),
    ).toBeVisible();
  });

  it("renders recorded supervisor action volume with distinct affected-order counts", async () => {
    const report = patternReport();
    report.supervisorInterventionTrend = [
      {
        date: "2026-11-04",
        interventions: 5,
        affectedWorkOrders: 2,
        supervisors: 1,
      },
    ];
    mount(report);
    const tab = await screen.findByRole("tab", { name: "Supervisor actions" });
    await userEvent.click(tab);
    const row = await screen.findByRole("row", { name: /2026-11-04/ });
    expect(row).toHaveTextContent("5");
    expect(row).toHaveTextContent("2");
    expect(row).toHaveTextContent("1");
    expect(
      screen.getByText(/recorded action volume, not employee performance/),
    ).toBeVisible();
  });
});

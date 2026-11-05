import { describe, expect, it } from "vitest";
import {
  figuresFor,
  quickActionsFor,
  type HomeFigureInput,
} from "../pages/home/content";
import type { Reports, Role } from "../types";

const roles: Role[] = [
  "Technician",
  "Dispatcher",
  "Supervisor",
  "OperationsManager",
  "Analyst",
  "Administrator",
];

const report: Reports = {
  totalWorkOrders: 12,
  completedWorkOrders: 7,
  completionRate: 0.58,
  slaComplianceRate: 0.91,
  averageServiceMinutes: 42,
  averageStageMinutes: 6,
  activeJobs: 5,
  atRiskStages: 2,
  overdueStages: 1,
  completedToday: 3,
  escalationFrequency: 0.1,
  schedulingEfficiency: 0.8,
  slaComplianceTrend: [],
  stageDurationDistribution: [],
  stageDurationSampleCount: 0,
  supervisorInterventionTrend: [],
  refreshedAtUtc: "2026-11-05T12:00:00Z",
  volumeTrend: [],
  stageMetrics: [],
  categoryBreakdown: [],
  technicianUtilization: [],
};

function inputFor(role: Role): HomeFigureInput {
  return {
    role,
    anyLoading: false,
    flowsPending: false,
    bookingsPending: false,
    techniciansPending: false,
    reportsPending: false,
    notificationsPending: false,
    unassignedCount: 3,
    todayBookingsCount: 2,
    technicianCount: 4,
    stage: undefined,
    risks: [],
    overdueCount: 0,
    unreadCount: 1,
    report,
  };
}

describe("role-based Home content", () => {
  it.each(roles)("provides three figures and three actions for %s", (role) => {
    expect(figuresFor(inputFor(role))).toHaveLength(3);
    expect(quickActionsFor(role)).toHaveLength(3);
  });

  it("keeps dispatcher work and supervision destinations role-specific", () => {
    expect(quickActionsFor("Dispatcher").map((action) => action.to)).toEqual([
      "/work-orders",
      "/schedule",
      "/work-orders/new",
    ]);
    expect(quickActionsFor("Supervisor").map((action) => action.to)).toEqual([
      "/supervisor",
      "/work-orders",
      "/replay",
    ]);
  });

  it("does not report supervisory risk when every workflow is on time", () => {
    const figures = figuresFor({
      ...inputFor("Supervisor"),
      overdueCount: 0,
      risks: [],
    });
    expect(figures[0]).toMatchObject({ value: 0, tone: "default" });
    expect(figures[1]).toMatchObject({ value: 0, tone: "default" });
  });
});

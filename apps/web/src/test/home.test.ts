import { describe, expect, it } from "vitest";
import {
  additionalRoles,
  currentStage,
  greetingFor,
  homeDestination,
  primaryRole,
  profileName,
  riskWorkflows,
  roleDescription,
  teamLabel,
  workflowRisk,
} from "../home";
import type { Workflow } from "../types";

const workflow = (status: string, stageSla: string): Workflow => ({
  id: `flow-${status}-${stageSla}`,
  workOrderId: "wo-1",
  technicianId: "tech-01",
  teamId: "north",
  templateVersion: 1,
  currentStageIndex: 1,
  version: 1,
  status,
  stages: [
    {
      id: "stage-1",
      index: 1,
      name: "Diagnose",
      status: "InProgress",
      slaStatus: stageSla,
      pausedSeconds: 0,
      answers: {},
    },
  ],
});

describe("role-aware Home model", () => {
  it("uses the broadest authorized operational role", () => {
    expect(primaryRole(["Analyst", "Technician"])).toBe("Technician");
    expect(primaryRole(["Supervisor", "OperationsManager"])).toBe(
      "OperationsManager",
    );
    expect(primaryRole(["Administrator", "Supervisor"])).toBe("Administrator");
  });

  it("handles missing and unsupported access without inventing a role", () => {
    expect(primaryRole([])).toBeNull();
    expect(roleDescription(null)).toContain("no FieldOps 360 role");
    expect(homeDestination(null)).toBe("/workspaces");
  });

  it("describes additional access without duplicating the primary role", () => {
    expect(additionalRoles(["Supervisor", "Analyst"], "Supervisor")).toEqual([
      "Analyst",
    ]);
  });

  it("uses readable team names and greeting boundaries", () => {
    expect(teamLabel("north")).toBe("North region");
    expect(teamLabel("training")).toBe("Training team");
    expect(teamLabel()).toBe("Team scope");
    expect(greetingFor(new Date("2026-11-05T08:00:00"))).toBe("Good morning");
    expect(greetingFor(new Date("2026-11-05T13:00:00"))).toBe("Good afternoon");
    expect(greetingFor(new Date("2026-11-05T20:00:00"))).toBe("Good evening");
  });

  it("takes only the display first name", () => {
    expect(profileName({ name: "Jordan Alvarez" })).toBe("Jordan");
    expect(profileName({ preferred_username: "dispatcher" })).toBe("Dispatcher");
    expect(profileName({})).toBe("there");
  });

  it("orders at-risk workflows by the current stage before healthy work", () => {
    const healthy = workflow("InProgress", "OnTime");
    const warning = workflow("InProgress", "Warning");
    const breached = workflow("InProgress", "Breached");
    const completed = workflow("Completed", "Breached");
    expect(currentStage(breached)?.name).toBe("Diagnose");
    expect(workflowRisk(breached)).toBeLessThan(workflowRisk(warning));
    expect(riskWorkflows([healthy, warning, breached, completed])).toEqual([
      breached,
      warning,
    ]);
  });
});

import type { Role, Workflow } from "./types";

/** The landing experience follows the broadest operational responsibility. */
export const ROLE_PRIORITY: Role[] = [
  "Administrator",
  "OperationsManager",
  "Supervisor",
  "Dispatcher",
  "Technician",
  "Analyst",
];

const labels: Record<Role, string> = {
  Technician: "Field technician",
  Dispatcher: "Dispatch",
  Supervisor: "Supervisor",
  OperationsManager: "Operations manager",
  Analyst: "Analyst",
  Administrator: "Administrator",
};

export function primaryRole(roles: Role[]): Role | null {
  return ROLE_PRIORITY.find((role) => roles.includes(role)) ?? null;
}

export function roleLabel(role: Role | null): string {
  return role ? labels[role] : "No application role";
}

export function teamLabel(teamId?: string): string {
  if (!teamId) return "Team scope";
  const known: Record<string, string> = {
    north: "North region",
    south: "South region",
    east: "East region",
    west: "West region",
  };
  if (known[teamId.toLowerCase()]) return known[teamId.toLowerCase()];
  return `${teamId.charAt(0).toUpperCase()}${teamId.slice(1)} team`;
}

export function roleDescription(role: Role | null, teamId?: string): string {
  const team = teamLabel(teamId);
  switch (role) {
    case "Technician":
      return "Your assigned work, current stage, and service deadlines.";
    case "Dispatcher":
      return `Unassigned work, upcoming bookings, and technician coverage for ${team}.`;
    case "Supervisor":
      return `At-risk service, overdue stages, and alerts that need a decision across ${team}.`;
    case "OperationsManager":
      return `Service performance, team capacity, and operational exceptions across ${team}.`;
    case "Analyst":
      return "Validated service metrics and the areas worth investigating next.";
    case "Administrator":
      return "Identity, workflow standards, and audit access across the platform.";
    default:
      return "Your account is signed in, but no FieldOps 360 role has been assigned.";
  }
}

export function profileName(profile: Record<string, unknown>): string {
  const named = [profile.name, profile.given_name, profile.preferred_username].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  if (!named) return "there";
  const clean = named.trim().split(/\s+/)[0];
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export function greetingFor(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function currentStage(workflow?: Workflow) {
  if (!workflow) return undefined;
  return workflow.stages.find(
    (stage) => stage.index === workflow.currentStageIndex,
  );
}

const riskWeight: Record<string, number> = {
  Breached: 0,
  Critical: 1,
  Warning: 2,
  OnTime: 3,
};

export function workflowRisk(workflow: Workflow): number {
  return riskWeight[currentStage(workflow)?.slaStatus ?? ""] ?? 4;
}

export function riskWorkflows(workflows: Workflow[]): Workflow[] {
  return workflows
    .filter((workflow) => workflow.status !== "Completed")
    .filter((workflow) =>
      ["Breached", "Critical", "Warning"].includes(
        currentStage(workflow)?.slaStatus ?? "",
      ),
    )
    .sort((left, right) => workflowRisk(left) - workflowRisk(right));
}

export function homeDestination(role: Role | null): string {
  switch (role) {
    case "Technician":
      return "/my-jobs";
    case "Dispatcher":
      return "/work-orders?status=Created";
    case "Supervisor":
      return "/supervisor";
    case "OperationsManager":
      return "/overview";
    case "Analyst":
      return "/analytics";
    case "Administrator":
      return "/administration";
    default:
      return "/workspaces";
  }
}

export function additionalRoles(roles: Role[], primary: Role): Role[] {
  return roles.filter(
    (role) => role !== primary && ROLE_PRIORITY.includes(role),
  );
}

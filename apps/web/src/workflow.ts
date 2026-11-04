import type { Workflow } from "./types";

export function completedStageCount(workflow?: Workflow): number {
  if (!workflow) return 0;
  // CurrentStageIndex still points at the final stage on completed instances.
  // Completion comes from recorded stage outcomes and the workflow's terminal state.
  if (workflow.status === "Completed") return 8;
  return Math.min(
    8,
    workflow.stages.filter((stage) =>
      ["Completed", "Overridden"].includes(stage.status),
    ).length,
  );
}

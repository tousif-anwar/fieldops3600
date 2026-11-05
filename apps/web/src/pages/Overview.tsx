import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button } from "@fluentui/react-components";
import {
  Activity,
  ArrowRight,
  CheckCheck,
  ClipboardList,
  Clock3,
  History,
  Plus,
  TriangleAlert,
  Users,
} from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import {
  Empty,
  ErrorState,
  Freshness,
  Loading,
  Metric,
  PageHeader,
  Panel,
  Status,
} from "../components/common";
import { dateTime, time } from "../format";
import type { Reports, WorkOrder, Workflow, Technician } from "../types";

export function Overview({ supervisor = false }: { supervisor?: boolean }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const orders = useQuery({
    queryKey: ["work-orders"],
    queryFn: () => api<WorkOrder[]>("/api/work-orders"),
  });
  const workflows = useQuery({
    queryKey: ["workflows"],
    queryFn: () => api<Workflow[]>("/api/workflows"),
    refetchInterval: 20000,
  });
  const technicians = useQuery({
    queryKey: ["technicians"],
    queryFn: () => api<Technician[]>("/api/technicians"),
    enabled: auth.can("Dispatcher", "Supervisor", "OperationsManager"),
  });
  const report = useQuery({
    queryKey: ["reports"],
    queryFn: () => api<Reports>("/api/reports/summary"),
    enabled: auth.can("Supervisor", "OperationsManager", "Analyst"),
    refetchInterval: 30000,
  });
  if (
    auth.roles.includes("Analyst") &&
    !auth.can("Dispatcher", "Supervisor", "OperationsManager", "Technician")
  )
    return <AnalystWelcome />;
  const all = orders.data ?? [];
  const flows = workflows.data ?? [];
  const active = flows.filter((f) => f.status !== "Completed");
  const stageFor = (f: Workflow) =>
    f.stages.find((s) => s.index === f.currentStageIndex);
  const risk = active.filter((f) =>
    /Warning|Critical/i.test(stageFor(f)?.slaStatus ?? ""),
  );
  const overdue = active.filter((f) =>
    /Breach/i.test(stageFor(f)?.slaStatus ?? ""),
  );
  const attention = [...active].sort((a, b) => {
    const weights: Record<string, number> = {
      Breached: 0,
      Critical: 1,
      Warning: 2,
      OnTime: 3,
    };
    return (
      (weights[stageFor(a)?.slaStatus ?? ""] ?? 4) -
      (weights[stageFor(b)?.slaStatus ?? ""] ?? 4)
    );
  });
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const utcToday = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader
        eyebrow={supervisor ? "REAL-TIME OPERATIONS" : "OPERATIONS AT A GLANCE"}
        title={
          supervisor ? "Keep your team moving." : "A clear view of your day."
        }
        description={
          supervisor
            ? "See where attention matters. Help your team before a delay becomes a disruption."
            : `${today} · Your team, work, and service performance in one place.`
        }
        actions={
          <>
            {auth.can("Dispatcher", "OperationsManager") && (
              <Button
                appearance="primary"
                icon={<Plus size={17} />}
                onClick={() => navigate("/work-orders/new")}
              >
                Create work order
              </Button>
            )}
          </>
        }
      />
      <div className="metrics-grid">
        <Metric
          label="Active jobs"
          value={report.data?.activeJobs ?? active.length}
          note="Work currently in progress"
          icon={<ClipboardList size={20} />}
        />
        <Metric
          label="At-risk stages"
          value={report.data?.atRiskStages ?? risk.length}
          note="Approaching their SLA deadline"
          icon={<Clock3 size={20} />}
          tone="amber"
        />
        <Metric
          label="Overdue stages"
          value={report.data?.overdueStages ?? overdue.length}
          note="Supervisor attention required"
          icon={<TriangleAlert size={20} />}
          tone="red"
        />
        <Metric
          label="Completed today (UTC)"
          value={
            report.data?.completedToday ??
            all.filter(
              (w) =>
                w.status === "Completed" &&
                w.completedAtUtc &&
                new Date(w.completedAtUtc).toISOString().slice(0, 10) ===
                  utcToday,
            ).length
          }
          note="Completions since midnight UTC"
          icon={<CheckCheck size={20} />}
          tone="green"
        />
      </div>
      {orders.isError && (
        <ErrorState error={orders.error} retry={() => void orders.refetch()} />
      )}
      <div className="overview-grid">
        <Panel
          title={supervisor ? "Jobs requiring attention" : "Live operations"}
          description="Prioritized by stage SLA status. All times are based on the server."
          action={
            <Freshness
              value={
                report.data?.refreshedAtUtc ??
                new Date(workflows.dataUpdatedAt || Date.now()).toISOString()
              }
            />
          }
        >
          {workflows.isPending ? (
            <Loading />
          ) : workflows.isError ? (
            <ErrorState
              error={workflows.error}
              retry={() => void workflows.refetch()}
            />
          ) : attention.length === 0 ? (
            <Empty
              title="Your workspace is ready"
              description="Create an order, confirm a booking, and start a workflow to see live service activity here."
              action={
                auth.can("Dispatcher") ? (
                  <Button onClick={() => navigate("/work-orders/new")}>
                    Create your first order
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Work order</th>
                    <th>Technician</th>
                    <th>Current stage</th>
                    <th>SLA status</th>
                    <th>Deadline</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {attention.slice(0, 8).map((f) => {
                    const stage = stageFor(f);
                    const order = all.find((w) => w.id === f.workOrderId);
                    return (
                      <tr key={f.id}>
                        <td>
                          <button
                            className="table-main-link"
                            onClick={() =>
                              navigate(`/work-orders/${f.workOrderId}`)
                            }
                          >
                            {order?.number ?? f.workOrderId.slice(0, 8)}
                          </button>
                          <small className="table-subline">
                            {order?.title ?? "Assigned service"}
                          </small>
                        </td>
                        <td>
                          <span className="person-cell">
                            <span className="mini-avatar">
                              {(
                                technicians.data?.find(
                                  (t) => t.id === f.technicianId,
                                )?.name ?? f.technicianId
                              )
                                .slice(0, 2)
                                .toUpperCase()}
                            </span>
                            {technicians.data?.find(
                              (t) => t.id === f.technicianId,
                            )?.name ?? f.technicianId}
                          </span>
                        </td>
                        <td>
                          {stage?.name ?? "Completed"}
                          <small className="table-subline">
                            Step {Math.min(f.currentStageIndex + 1, 8)} of 8
                          </small>
                        </td>
                        <td>
                          <Status
                            value={
                              stage?.pausedAtUtc
                                ? "Paused"
                                : (stage?.slaStatus ?? "OnTime")
                            }
                          />
                        </td>
                        <td>{time(stage?.deadlineUtc)}</td>
                        <td>
                          <Button
                            appearance="subtle"
                            aria-label={`Open workflow for ${order?.number ?? f.workOrderId}`}
                            icon={<ArrowRight size={16} />}
                            onClick={() => navigate(`/workflow/${f.id}`)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <div className="overview-side">
          <Panel
            title="The next right action"
            description="Useful shortcuts for a connected service day."
          >
            <div className="quick-actions">
              <button onClick={() => navigate("/schedule")}>
                <span className="quick-icon">
                  <Users size={20} />
                </span>
                <span>
                  <strong>Plan the day</strong>
                  <small>Find qualified, available technicians</small>
                </span>
                <ArrowRight size={16} />
              </button>
              <button onClick={() => navigate("/my-jobs")}>
                <span className="quick-icon green">
                  <Activity size={20} />
                </span>
                <span>
                  <strong>Continue field work</strong>
                  <small>Follow the guided service pipeline</small>
                </span>
                <ArrowRight size={16} />
              </button>
              {auth.can("Supervisor", "OperationsManager") && (
                <button onClick={() => navigate("/replay")}>
                  <span className="quick-icon purple">
                    <History size={20} />
                  </span>
                  <span>
                    <strong>Understand an incident</strong>
                    <small>Replay the complete recorded history</small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              )}
            </div>
          </Panel>
          <div className="sla-guide">
            <span className="eyebrow">A SHARED SERVICE STANDARD</span>
            <h3>
              30 minutes.
              <br />
              Clear signals at every step.
            </h3>
            <div className="sla-scale">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="sla-labels">
              <span>On time</span>
              <span>20m</span>
              <span>25m</span>
              <span>30m</span>
            </div>
            <p>
              Early warnings help your team act. Approved pauses are excluded
              from elapsed SLA time.
            </p>
          </div>
        </div>
      </div>
      <Panel
        title="Recent work orders"
        description="The latest service requests across your authorized team."
        action={
          <Button
            appearance="subtle"
            iconPosition="after"
            icon={<ArrowRight size={15} />}
            onClick={() => navigate("/work-orders")}
          >
            All work orders
          </Button>
        }
      >
        {orders.isPending ? (
          <Loading />
        ) : all.length === 0 ? (
          <Empty
            title="No work orders yet"
            description="New service requests will appear here as they are created."
          />
        ) : (
          <div className="recent-cards">
            {[...all]
              .sort(
                (a, b) =>
                  Date.parse(b.createdAtUtc) - Date.parse(a.createdAtUtc),
              )
              .slice(0, 4)
              .map((w) => (
                <button
                  key={w.id}
                  className="recent-order"
                  onClick={() => navigate(`/work-orders/${w.id}`)}
                >
                  <div>
                    <span className="order-number">{w.number}</span>
                    <Status value={w.priority} />
                  </div>
                  <strong>{w.title}</strong>
                  <p>
                    {w.customerName} <span>·</span> {w.serviceCategory}
                  </p>
                  <footer>
                    <Status value={w.status} />
                    <small>{dateTime(w.createdAtUtc)}</small>
                  </footer>
                </button>
              ))}
          </div>
        )}
      </Panel>
    </>
  );
}
function AnalystWelcome() {
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        eyebrow="ANALYST WORKSPACE"
        title="Turn service history into insight."
        description="Explore validated operational metrics, trace their definitions, and export the evidence."
      />
      <Panel
        title="Your reporting workspace"
        description="Analysts access masked warehouse data within their authorized scope."
      >
        <div className="padded">
          <Button
            appearance="primary"
            onClick={() => navigate("/analytics")}
            icon={<ArrowRight size={17} />}
            iconPosition="after"
          >
            Open analytics
          </Button>
        </div>
      </Panel>
    </>
  );
}

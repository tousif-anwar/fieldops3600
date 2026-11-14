import { Link } from "react-router-dom";
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
        title={supervisor ? "SLA monitoring" : "Operations overview"}
        description={
          supervisor
            ? `${today} · At-risk work, overdue stages, and recorded interventions.`
            : `${today} · Work, service performance, and recent activity for your team.`
        }
        actions={
          <>
            {auth.can("Dispatcher", "OperationsManager") && (
              <Link to={"/work-orders/new"} className="button-link primary">
                <Plus aria-hidden="true" size={17} />
                Create work order
              </Link>
            )}
          </>
        }
      />
      <div className="metrics-grid">
        <Metric
          label="Active jobs"
          value={
            report.data?.activeJobs ??
            (workflows.isSuccess ? active.length : "—")
          }
          note="Work currently in progress"
          icon={<ClipboardList aria-hidden="true" size={20} />}
        />
        <Metric
          label="At-risk stages"
          value={
            report.data?.atRiskStages ??
            (workflows.isSuccess ? risk.length : "—")
          }
          note="Approaching their SLA deadline"
          icon={<Clock3 aria-hidden="true" size={20} />}
          tone="amber"
        />
        <Metric
          label="Overdue stages"
          value={
            report.data?.overdueStages ??
            (workflows.isSuccess ? overdue.length : "—")
          }
          note="Supervisor attention required"
          icon={<TriangleAlert aria-hidden="true" size={20} />}
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
          icon={<CheckCheck aria-hidden="true" size={20} />}
          tone="green"
        />
      </div>
      {orders.isError && (
        <ErrorState error={orders.error} retry={() => void orders.refetch()} />
      )}
      <div className="overview-grid">
        <Panel
          title={supervisor ? "Jobs requiring attention" : "Live operations"}
          description="Sorted by recorded SLA status."
          action={
            <Freshness
              value={
                report.data?.refreshedAtUtc ??
                (workflows.dataUpdatedAt
                  ? new Date(workflows.dataUpdatedAt).toISOString()
                  : null)
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
              title="No active workflows"
              description="Confirm a booking and start a workflow to track service."
              action={
                auth.can("Dispatcher") ? (
                  <Link to={"/work-orders/new"} className="button-link">
                    Create your first order
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <div
              tabIndex={0}
              role="region"
              aria-label="Active service workflows"
              className="table-scroll"
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">Work order</th>
                    <th scope="col">Technician</th>
                    <th scope="col">Current stage</th>
                    <th scope="col">SLA status</th>
                    <th scope="col">Deadline</th>
                    <th scope="col">
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
                          <Link
                            to={`/work-orders/${f.workOrderId}`}
                            className="table-main-link"
                          >
                            {order?.number ?? f.workOrderId.slice(0, 8)}
                          </Link>
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
                            icon={<ArrowRight aria-hidden="true" size={16} />}
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
          <Panel title="Actions">
            <div className="quick-actions">
              <Link to={"/schedule"}>
                <span className="quick-icon">
                  <Users aria-hidden="true" size={20} />
                </span>
                <span>
                  <strong>Plan the day</strong>
                  <small>Find qualified, available technicians</small>
                </span>
                <ArrowRight aria-hidden="true" size={16} />
              </Link>
              <Link to={"/my-jobs"}>
                <span className="quick-icon green">
                  <Activity aria-hidden="true" size={20} />
                </span>
                <span>
                  <strong>Continue field work</strong>
                  <small>Follow the guided service pipeline</small>
                </span>
                <ArrowRight aria-hidden="true" size={16} />
              </Link>
              {auth.can("Supervisor", "OperationsManager") && (
                <Link to={"/replay"}>
                  <span className="quick-icon purple">
                    <History aria-hidden="true" size={20} />
                  </span>
                  <span>
                    <strong>Understand an incident</strong>
                    <small>Replay the complete recorded history</small>
                  </span>
                  <ArrowRight aria-hidden="true" size={16} />
                </Link>
              )}
            </div>
          </Panel>
        </div>
      </div>
      <Panel
        title="Recent work orders"

        action={
          <Link to={"/work-orders"} className="button-link">
            <ArrowRight aria-hidden="true" size={15} />
            All work orders
          </Link>
        }
      >
        {orders.isPending ? (
          <Loading />
        ) : all.length === 0 ? (
          <Empty
            title="No work orders yet"
            description="Create a work order to get started."
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
                <Link
                  to={`/work-orders/${w.id}`}
                  className="recent-order"
                  key={w.id}
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
                </Link>
              ))}
          </div>
        )}
      </Panel>
    </>
  );
}
function AnalystWelcome() {
  return (
    <>
      <PageHeader title="Reports" />
      <Panel
        title="Your reporting workspace"
        description="Reports contain masked warehouse data."
      >
        <div className="padded">
          <Link to={"/analytics"} className="button-link primary">
            <ArrowRight aria-hidden="true" size={17} />
            Open analytics
          </Link>
        </div>
      </Panel>
    </>
  );
}

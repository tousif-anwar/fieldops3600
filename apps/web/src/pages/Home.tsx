import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@fluentui/react-components";
import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { ErrorState, Loading, Status } from "../components/common";
import { dateTime, humanize, percent, time } from "../format";
import {
  additionalRoles,
  homeDestination,
  currentStage,
  greetingFor,
  profileName,
  primaryRole,
  riskWorkflows,
  roleDescription,
  roleLabel,
  teamLabel,
} from "../home";
import {
  figuresFor,
  quickActionsFor,
  type Action,
  type Figure,
} from "./home/content";
import type {
  Booking,
  Notification,
  Reports,
  Technician,
  Workflow,
  WorkOrder,
} from "../types";

function Panel({
  title,
  description,
  action,
  className = "",
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`home-panel ${className}`}>
      <header className="home-panel-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Snapshot({ figures }: { figures: Figure[] }) {
  return (
    <section className="home-snapshot" aria-label="Your current workspace">
      {figures.map((figure) => (
        <div className="home-figure" key={figure.label}>
          <span>{figure.label}</span>
          <strong className={figure.tone ? `tone-${figure.tone}` : undefined}>
            {figure.value}
          </strong>
          <small>{figure.detail}</small>
        </div>
      ))}
    </section>
  );
}

function AttentionRow({
  to,
  title,
  meta,
  status,
  action = "Open",
  tone = "info",
}: {
  to: string;
  title: string;
  meta: string;
  status?: string;
  action?: string;
  tone?: "danger" | "warning" | "info" | "success";
}) {
  return (
    <Link className="attention-row" to={to}>
      <span className={`attention-rail ${tone}`} aria-hidden="true" />
      <span className="attention-copy">
        <strong>{title}</strong>
        <small>{meta}</small>
      </span>
      {status && <Status value={status} />}
      <span className="attention-action">
        {action}
        <ArrowRight size={15} aria-hidden="true" />
      </span>
    </Link>
  );
}

function EmptyAttention({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="home-empty">
      <CheckCircle2 size={22} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </div>
  );
}

function QuickActions({ actions }: { actions: Action[] }) {
  return (
    <Panel title="Quick access" className="home-quick">
      <div className="home-actions">
        {actions.map((action) => (
          <Link
            to={action.to}
            className="home-action"
            key={`${action.to}-${action.label}`}
          >
            <span className="home-action-icon">{action.icon}</span>
            <span>
              <strong>{action.label}</strong>
              <small>{action.description}</small>
            </span>
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        ))}
      </div>
    </Panel>
  );
}

function WorkList({
  rows,
}: {
  rows: {
    key?: string;
    to: string;
    title: string;
    meta: string;
    trailing?: ReactNode;
  }[];
}) {
  return (
    <div className="home-work-list">
      {rows.map((row) => (
        <Link
          className="home-work-row"
          to={row.to}
          key={row.key ?? `${row.to}-${row.title}`}
        >
          <span>
            <strong>{row.title}</strong>
            <small>{row.meta}</small>
          </span>
          {row.trailing}
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}

function currentOrderNumber(order?: WorkOrder) {
  return order?.number ?? "Work order";
}

export function Home() {
  const auth = useAuth();
  const role = primaryRole(auth.roles);
  const teamId = String(
    auth.user?.profile.team_id ?? auth.user?.profile.teamId ?? "",
  );
  const name = profileName(
    (auth.user?.profile ?? {}) as Record<string, unknown>,
  );
  const otherRoles = role ? additionalRoles(auth.roles, role) : [];
  const now = new Date();
  const today = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);

  const workRole =
    role === "Technician" ||
    role === "Dispatcher" ||
    role === "Supervisor" ||
    role === "OperationsManager";
  const flowRole =
    role === "Technician" ||
    role === "Supervisor" ||
    role === "OperationsManager";
  const dispatchRole =
    role === "Dispatcher" ||
    role === "Supervisor" ||
    role === "OperationsManager";
  const reportRole =
    role === "Supervisor" || role === "OperationsManager" || role === "Analyst";

  const ordersQuery = useQuery({
    queryKey: ["work-orders"],
    queryFn: () => api<WorkOrder[]>("/api/work-orders"),
    enabled: workRole,
  });
  const flowsQuery = useQuery({
    queryKey: ["workflows"],
    queryFn: () => api<Workflow[]>("/api/workflows"),
    enabled: flowRole,
    refetchInterval: 20000,
  });
  const techniciansQuery = useQuery({
    queryKey: ["technicians"],
    queryFn: () => api<Technician[]>("/api/technicians"),
    enabled: dispatchRole,
  });
  const bookingsQuery = useQuery({
    queryKey: ["bookings"],
    queryFn: () => api<Booking[]>("/api/bookings"),
    enabled: role === "Technician" || role === "Dispatcher",
  });
  const reportQuery = useQuery({
    queryKey: ["reports"],
    queryFn: () => api<Reports>("/api/reports/summary"),
    enabled: reportRole,
    refetchInterval: 30000,
  });
  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<Notification[]>("/api/notifications"),
    enabled: role !== "Analyst",
    refetchInterval: 30000,
  });

  if (!role) {
    return (
      <div className="home-page">
        <header className="home-header">
          <div className="home-intro">
            <p className="home-context">Access not configured</p>
            <h1 className="home-greeting">
              {greetingFor(now)}, {name}.
            </h1>
            <p className="home-summary">{roleDescription(role, teamId)}</p>
          </div>
        </header>
        <Panel title="Ask for access">
          <div className="home-empty">
            <ShieldCheck size={22} aria-hidden="true" />
            <div>
              <strong>
                Your identity is valid, but no FieldOps 360 role is assigned.
              </strong>
              <p>
                Contact your administrator to add the role that matches your
                work. This page does not infer access from another directory
                group.
              </p>
            </div>
          </div>
          <div className="home-empty-actions">
            <Button appearance="primary" onClick={() => void auth.logout()}>
              Sign out
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  const orders = ordersQuery.data ?? [];
  const flows = flowsQuery.data ?? [];
  const activeFlows = flows.filter((flow) => flow.status !== "Completed");
  const risks = riskWorkflows(flows);
  const overdue = risks.filter(
    (flow) => currentStage(flow)?.slaStatus === "Breached",
  );
  const unread = (notificationsQuery.data ?? []).filter(
    (notification) => !notification.acknowledgedAtUtc,
  );
  const unassigned = orders
    .filter(
      (order) =>
        !order.technicianId &&
        !["Completed", "Cancelled"].includes(order.status),
    )
    .sort((left, right) => {
      const rank: Record<string, number> = {
        Critical: 0,
        High: 1,
        Normal: 2,
        Low: 3,
      };
      return (rank[left.priority] ?? 4) - (rank[right.priority] ?? 4);
    });
  const currentFlow =
    activeFlows.find((flow) => flow.status === "InProgress") ?? activeFlows[0];
  const currentOrder = orders.find(
    (order) => order.id === currentFlow?.workOrderId,
  );
  const stage = currentStage(currentFlow);
  const assignedOrders = orders
    .filter(
      (order) =>
        order.technicianId === auth.user?.profile.sub &&
        !["Completed", "Cancelled"].includes(order.status),
    )
    .sort((left, right) => left.number.localeCompare(right.number));
  const todayKey = now.toDateString();
  const bookings = bookingsQuery.data ?? [];
  const todayBookings = bookings.filter(
    (booking) =>
      booking.status === "Confirmed" &&
      new Date(booking.startUtc).toDateString() === todayKey,
  );
  const upcoming = [...bookings]
    .filter(
      (booking) =>
        booking.status === "Confirmed" &&
        Date.parse(booking.startUtc) >= now.getTime(),
    )
    .sort(
      (left, right) => Date.parse(left.startUtc) - Date.parse(right.startUtc),
    );
  const report = reportQuery.data;
  const primaryError =
    (ordersQuery.error as Error | null) ??
    (flowsQuery.error as Error | null) ??
    (reportQuery.error as Error | null) ??
    null;
  const anyLoading =
    (workRole && ordersQuery.isPending) ||
    (flowRole && flowsQuery.isPending) ||
    (reportRole && reportQuery.isPending) ||
    (role !== "Analyst" && notificationsQuery.isPending);

  const figures = figuresFor({
    role,
    anyLoading,
    flowsPending: flowsQuery.isPending,
    bookingsPending: bookingsQuery.isPending,
    techniciansPending: techniciansQuery.isPending,
    reportsPending: reportQuery.isPending,
    notificationsPending: notificationsQuery.isPending,
    unassignedCount: unassigned.length,
    todayBookingsCount: todayBookings.length,
    technicianCount: techniciansQuery.data?.length ?? 0,
    currentOrder,
    currentFlow,
    stage,
    risks,
    overdueCount: overdue.length,
    unreadCount: unread.length,
    report,
  });
  const quickActions = quickActionsFor(role);

  return (
    <div className="home-page">
      <header className="home-header">
        <div className="home-intro">
          <p className="home-context">
            <span className="home-role-dot" aria-hidden="true" />
            {roleLabel(role)} <span aria-hidden="true">·</span>{" "}
            {teamLabel(teamId)}
          </p>
          <h1 className="home-greeting">
            {greetingFor(now)}, {name}.
          </h1>
          <p className="home-summary">{roleDescription(role, teamId)}</p>
          {otherRoles.length > 0 && (
            <p className="home-additional-roles">
              Also authorized: {otherRoles.map(roleLabel).join(", ")}
            </p>
          )}
        </div>
        <div className="home-today">
          <span>Today</span>
          <strong>{today}</strong>
          <small>Times follow your device locale</small>
        </div>
      </header>

      <Snapshot figures={figures} />

      {primaryError && (
        <ErrorState
          error={primaryError}
          retry={() => {
            void ordersQuery.refetch();
            void flowsQuery.refetch();
            void reportQuery.refetch();
          }}
        />
      )}

      <div className="home-grid">
        <Panel
          title={
            role === "Analyst"
              ? "Start an analysis"
              : role === "Administrator"
                ? "Administration areas"
                : "Needs attention"
          }
          description={
            role === "Technician"
              ? "Your current job, deadline, and unread notices."
              : role === "Dispatcher"
                ? "Work that still needs an owner."
                : role === "Supervisor"
                  ? "Stages and alerts that need a decision."
                  : role === "OperationsManager"
                    ? "Exceptions that may affect service performance."
                    : role === "Analyst"
                      ? "Choose a reporting area; all metrics remain in the analytics workspace."
                      : "Start with the area you need to configure or review."
          }
          action={
            <Link className="home-panel-link" to={homeDestination(role)}>
              Open workspace <ArrowRight size={15} aria-hidden="true" />
            </Link>
          }
          className="home-attention"
        >
          {anyLoading && role !== "Administrator" ? (
            <Loading label="Loading your priority work…" />
          ) : role === "Technician" ? (
            <div className="home-attention-list">
              {unread.slice(0, 2).map((notification) => (
                <AttentionRow
                  key={notification.id}
                  to="/notifications"
                  title={
                    notification.title ??
                    humanize(notification.eventType ?? "Service notice")
                  }
                  meta={notification.message ?? "Unread operational notice"}
                  status="Unread"
                  tone="warning"
                  action="Review"
                />
              ))}
              {stage &&
                ["Warning", "Critical", "Breached"].includes(stage.slaStatus) &&
                currentFlow && (
                  <AttentionRow
                    to={`/workflow/${currentFlow.id}`}
                    title={`${currentOrderNumber(currentOrder)} · ${stage.name}`}
                    meta={
                      stage.deadlineUtc
                        ? `Stage deadline ${time(stage.deadlineUtc)}`
                        : "Stage requires review"
                    }
                    status={stage.slaStatus}
                    tone={stage.slaStatus === "Breached" ? "danger" : "warning"}
                    action={
                      stage.slaStatus === "Breached" ? "Review" : "Continue"
                    }
                  />
                )}
              {unread.length === 0 &&
                !(
                  stage &&
                  ["Warning", "Critical", "Breached"].includes(stage.slaStatus)
                ) && (
                  <EmptyAttention
                    title="Nothing urgent right now"
                    description={
                      currentFlow
                        ? "Your current stage is on time and no unread notices need action."
                        : "New assignments and SLA warnings will appear here."
                    }
                  />
                )}
            </div>
          ) : role === "Dispatcher" ? (
            <div className="home-attention-list">
              {unassigned.length === 0 ? (
                <EmptyAttention
                  title="Every active request has an owner"
                  description="New unassigned work will appear here with its priority and service category."
                />
              ) : (
                unassigned
                  .slice(0, 5)
                  .map((order) => (
                    <AttentionRow
                      key={order.id}
                      to={`/schedule?workOrderId=${order.id}`}
                      title={`${order.number} · ${order.title}`}
                      meta={`${order.serviceCategory} · ${order.siteAddress}`}
                      status={order.priority}
                      tone={
                        order.priority === "Critical"
                          ? "danger"
                          : order.priority === "High"
                            ? "warning"
                            : "info"
                      }
                      action="Assign"
                    />
                  ))
              )}
            </div>
          ) : role === "Supervisor" || role === "OperationsManager" ? (
            <div className="home-attention-list">
              {risks.length === 0 ? (
                <EmptyAttention
                  title="No stage is at risk"
                  description="Active workflows are currently within their SLA thresholds."
                />
              ) : (
                risks.slice(0, 5).map((flow) => {
                  const riskStage = currentStage(flow);
                  return (
                    <AttentionRow
                      key={flow.id}
                      to={`/workflow/${flow.id}`}
                      title={`${currentOrderNumber(orders.find((order) => order.id === flow.workOrderId))} · ${riskStage?.name ?? "Workflow"}`}
                      meta={`${techniciansQuery.data?.find((technician) => technician.id === flow.technicianId)?.name ?? flow.technicianId} · ${riskStage?.deadlineUtc ? `Deadline ${time(riskStage.deadlineUtc)}` : "Deadline pending"}`}
                      status={
                        riskStage?.pausedAtUtc
                          ? "Paused"
                          : (riskStage?.slaStatus ?? "Warning")
                      }
                      tone={
                        riskStage?.slaStatus === "Breached"
                          ? "danger"
                          : "warning"
                      }
                      action="Investigate"
                    />
                  );
                })
              )}
            </div>
          ) : role === "Analyst" ? (
            <div className="home-attention-list">
              {[
                {
                  title: "SLA performance",
                  meta: "Compliance trend, breaches, and completed stages",
                },
                {
                  title: "Stage durations",
                  meta: "Effective duration distribution and unknown samples",
                },
                {
                  title: "Service mix and volume",
                  meta: "Demand, categories, and completion cohorts",
                },
              ].map((item) => (
                <AttentionRow
                  key={item.title}
                  to="/analytics"
                  title={item.title}
                  meta={item.meta}
                  action="Analyze"
                />
              ))}
            </div>
          ) : (
            <div className="home-attention-list">
              <AttentionRow
                to="/administration"
                title="Identity and access"
                meta="Review users, realm roles, and credential policy in Keycloak"
                action="Open"
              />
              <AttentionRow
                to="/replay"
                title="Audit evidence"
                meta="Inspect recorded operational history without changing it"
                action="Inspect"
              />
              <AttentionRow
                to="/analytics"
                title="Service performance"
                meta="Review platform-wide warehouse metrics"
                action="Analyze"
              />
            </div>
          )}
        </Panel>

        <QuickActions actions={quickActions} />
      </div>

      {role === "Technician" && (
        <Panel
          title="Your assigned work"
          description="Open jobs assigned to you. Your current job is listed first."
          action={
            <Link className="home-panel-link" to="/my-jobs">
              My work <ArrowRight size={15} aria-hidden="true" />
            </Link>
          }
        >
          {assignedOrders.length === 0 ? (
            <EmptyAttention
              title="No open jobs assigned"
              description="Confirmed assignments from dispatch will appear here."
            />
          ) : (
            <WorkList
              rows={assignedOrders.slice(0, 4).map((order) => ({
                to: `/work-orders/${order.id}`,
                title: `${order.number} · ${order.title}`,
                meta: `${order.customerName} · ${order.serviceCategory} · ${order.status}`,
                trailing: <Status value={order.priority} />,
              }))}
            />
          )}
        </Panel>
      )}

      {role === "Dispatcher" && (
        <Panel
          title="Upcoming appointments"
          description="Confirmed bookings across your authorized team."
          action={
            <Link className="home-panel-link" to="/schedule">
              Dispatch board <ArrowRight size={15} aria-hidden="true" />
            </Link>
          }
        >
          {upcoming.length === 0 ? (
            <EmptyAttention
              title="No upcoming appointments"
              description="Confirmed bookings will appear here with their technician and time."
            />
          ) : (
            <WorkList
              rows={upcoming.slice(0, 4).map((booking) => {
                const order = orders.find(
                  (item) => item.id === booking.workOrderId,
                );
                const technician = techniciansQuery.data?.find(
                  (item) => item.id === booking.technicianId,
                );
                return {
                  to: `/schedule?workOrderId=${booking.workOrderId}`,
                  title: `${dateTime(booking.startUtc)} · ${order?.number ?? "Work order"}`,
                  meta: `${order?.title ?? "Service appointment"} · ${technician?.name ?? booking.technicianId}`,
                  trailing: <Status value={booking.status} />,
                };
              })}
            />
          )}
        </Panel>
      )}

      {role === "Supervisor" && (
        <Panel
          title="Recent alerts"
          description="The latest notices for your authorized team."
          action={
            <Link className="home-panel-link" to="/notifications">
              All notifications <ArrowRight size={15} aria-hidden="true" />
            </Link>
          }
        >
          {(notificationsQuery.data ?? []).length === 0 ? (
            <EmptyAttention
              title="No alerts recorded"
              description="SLA warnings, breaches, and supervisor notices will appear here."
            />
          ) : (
            <WorkList
              rows={(notificationsQuery.data ?? [])
                .slice(0, 4)
                .map((notification) => ({
                  key: notification.id,
                  to: "/notifications",
                  title:
                    notification.title ??
                    humanize(notification.eventType ?? "Service notice"),
                  meta: `${notification.message ?? "Operational notice"} · ${dateTime(notification.createdAtUtc)}`,
                  trailing: notification.acknowledgedAtUtc ? (
                    <Status value="Acknowledged" />
                  ) : (
                    <Status value="Unread" />
                  ),
                }))}
            />
          )}
        </Panel>
      )}

      {role === "OperationsManager" && (
        <Panel
          title="Technician capacity"
          description="Confirmed booked time as a share of published working capacity."
          action={
            <Link className="home-panel-link" to="/analytics">
              Explore capacity <ArrowRight size={15} aria-hidden="true" />
            </Link>
          }
        >
          {!report || report.technicianUtilization.length === 0 ? (
            <EmptyAttention
              title="Capacity is not available yet"
              description="A utilization figure appears only when published working hours and booking data exist."
            />
          ) : (
            <div className="home-capacity-list">
              {report.technicianUtilization.slice(0, 4).map((technician) => (
                <div
                  className="home-capacity-row"
                  key={technician.technicianId}
                >
                  <span>
                    <strong>
                      {techniciansQuery.data?.find(
                        (item) => item.id === technician.technicianId,
                      )?.name ?? technician.technicianId}
                    </strong>
                    <small>
                      {technician.utilization == null
                        ? "Unknown capacity"
                        : `${technician.bookedMinutes.toFixed(0)} booked minutes`}
                    </small>
                  </span>
                  <div className="home-capacity-track" aria-hidden="true">
                    <span
                      style={{
                        width: `${Math.min(Math.max((technician.utilization ?? 0) * 100, 0), 100)}%`,
                      }}
                    />
                  </div>
                  <strong>{percent(technician.utilization)}</strong>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {role === "Analyst" && report && (
        <Panel
          title="Reporting coverage"
          description="Categories currently represented in the warehouse scope."
        >
          {report.categoryBreakdown.length === 0 ? (
            <EmptyAttention
              title="No category observations"
              description="Coverage appears after work order events have been ingested."
            />
          ) : (
            <div className="home-coverage-list">
              {report.categoryBreakdown.map((category) => (
                <div key={category.category}>
                  <span>{category.category}</span>
                  <strong>{category.count}</strong>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

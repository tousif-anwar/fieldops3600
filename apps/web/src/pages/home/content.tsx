import type { ReactNode } from "react";
import {
  Activity,
  BarChart3,
  Bell,
  CalendarDays,
  ClipboardList,
  History,
  LayoutGrid,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { percent } from "../../format";
import { currentStage } from "../../home";
import type { Reports, Role, Stage, WorkOrder, Workflow } from "../../types";

export interface Figure {
  label: string;
  value: ReactNode;
  detail: string;
  tone?: "default" | "warning" | "danger" | "success";
}

export interface Action {
  to: string;
  label: string;
  description: string;
  icon: ReactNode;
}

export interface HomeFigureInput {
  role: Role;
  /** True only while a query enabled for this role is still loading. */
  anyLoading: boolean;
  flowsPending: boolean;
  bookingsPending: boolean;
  techniciansPending: boolean;
  reportsPending: boolean;
  notificationsPending: boolean;
  unassignedCount: number;
  todayBookingsCount: number;
  technicianCount: number;
  currentOrder?: WorkOrder;
  currentFlow?: Workflow;
  stage?: Stage;
  risks: Workflow[];
  overdueCount: number;
  unreadCount: number;
  report?: Reports;
}

export function figuresFor(input: HomeFigureInput): Figure[] {
  const {
    role,
    anyLoading,
    flowsPending,
    bookingsPending,
    techniciansPending,
    reportsPending,
    notificationsPending,
    unassignedCount,
    todayBookingsCount,
    technicianCount,
    currentOrder,
    currentFlow,
    stage,
    risks,
    overdueCount,
    unreadCount,
    report,
  } = input;

  if (role === "Technician") {
    return [
      {
        label: "Current job",
        value: currentOrder?.number ?? "None",
        detail: currentOrder?.title ?? "No active assignment",
      },
      {
        label: "Current stage",
        value: stage?.name ?? "Not started",
        detail: currentFlow
          ? `Step ${currentFlow.currentStageIndex + 1} of ${currentFlow.stages.length}`
          : "Open My work to begin",
      },
      {
        label: "Stage SLA",
        value: stage?.pausedAtUtc ? "Paused" : (stage?.slaStatus ?? "—"),
        detail: stage?.deadlineUtc
          ? `Due ${new Date(stage.deadlineUtc).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}`
          : "No active deadline",
        tone:
          stage?.slaStatus === "Breached"
            ? "danger"
            : stage?.slaStatus === "Warning" || stage?.slaStatus === "Critical"
              ? "warning"
              : "default",
      },
    ];
  }

  if (role === "Dispatcher") {
    return [
      {
        label: "Unassigned",
        value: anyLoading ? "—" : unassignedCount,
        detail: "Open service requests without a technician",
        tone: unassignedCount ? "warning" : "default",
      },
      {
        label: "Today’s bookings",
        value: bookingsPending ? "—" : todayBookingsCount,
        detail: "Confirmed appointments in local time",
      },
      {
        label: "Active technicians",
        value: techniciansPending ? "—" : technicianCount,
        detail: "Profiles in your authorized team",
      },
    ];
  }

  if (role === "Supervisor") {
    const atRisk = risks.filter(
      (flow) => currentStage(flow)?.slaStatus !== "Breached",
    );
    return [
      {
        label: "At risk",
        value: flowsPending ? "—" : atRisk.length,
        detail: "Stages approaching a deadline",
        tone: atRisk.length ? "warning" : "default",
      },
      {
        label: "Overdue",
        value: flowsPending ? "—" : overdueCount,
        detail: "Stages with a recorded breach",
        tone: overdueCount ? "danger" : "default",
      },
      {
        label: "Unread alerts",
        value: notificationsPending ? "—" : unreadCount,
        detail: "Signals not yet acknowledged",
        tone: unreadCount ? "warning" : "default",
      },
    ];
  }

  if (role === "OperationsManager") {
    return [
      {
        label: "Completion rate",
        value: reportsPending ? "—" : percent(report?.completionRate),
        detail: report
          ? `${report.completedWorkOrders} of ${report.totalWorkOrders} orders`
          : "Warehouse summary",
      },
      {
        label: "SLA compliance",
        value: reportsPending ? "—" : percent(report?.slaComplianceRate),
        detail: "Completed stages without a breach",
      },
      {
        label: "Active jobs",
        value: reportsPending ? "—" : (report?.activeJobs ?? "—"),
        detail: `${report?.atRiskStages ?? "—"} at risk · ${report?.overdueStages ?? "—"} overdue`,
        tone: report?.overdueStages ? "danger" : "default",
      },
    ];
  }

  if (role === "Analyst") {
    return [
      {
        label: "Work orders",
        value: reportsPending ? "—" : (report?.totalWorkOrders ?? 0),
        detail: "In the current reporting scope",
      },
      {
        label: "SLA compliance",
        value: reportsPending ? "—" : percent(report?.slaComplianceRate),
        detail: "Completed stages without a breach",
      },
      {
        label: "Warehouse freshness",
        value: report?.refreshedAtUtc
          ? new Intl.DateTimeFormat(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(report.refreshedAtUtc))
          : "—",
        detail: report?.refreshedAtUtc
          ? "Latest recorded ingestion"
          : "Awaiting ingestion",
      },
    ];
  }

  return [
    {
      label: "Access scope",
      value: "All teams",
      detail: "Administrator policy",
    },
    {
      label: "Audit evidence",
      value: "Available",
      detail: "Operational replay access",
    },
    {
      label: "Identity",
      value: "Keycloak",
      detail: "Realm-managed users and roles",
    },
  ];
}

export function quickActionsFor(role: Role): Action[] {
  if (role === "Technician") {
    return [
      {
        to: "/my-jobs",
        label: "My work",
        description: "Assigned jobs and guided stages",
        icon: <Wrench size={19} />,
      },
      {
        to: "/schedule",
        label: "My schedule",
        description: "Appointments and booking times",
        icon: <CalendarDays size={19} />,
      },
      {
        to: "/notifications",
        label: "Alerts",
        description: "Supervisor and SLA notices",
        icon: <Bell size={19} />,
      },
    ];
  }

  if (role === "Dispatcher") {
    return [
      {
        to: "/work-orders",
        label: "Work orders",
        description: "Search and review service requests",
        icon: <ClipboardList size={19} />,
      },
      {
        to: "/schedule",
        label: "Dispatch board",
        description: "Match work to qualified technicians",
        icon: <CalendarDays size={19} />,
      },
      {
        to: "/work-orders/new",
        label: "Create work order",
        description: "Record a new service request",
        icon: <Activity size={19} />,
      },
    ];
  }

  if (role === "Supervisor") {
    return [
      {
        to: "/supervisor",
        label: "SLA monitoring",
        description: "Investigate at-risk and overdue stages",
        icon: <TriangleAlert size={19} />,
      },
      {
        to: "/work-orders",
        label: "Work orders",
        description: "Review service requests for your team",
        icon: <ClipboardList size={19} />,
      },
      {
        to: "/replay",
        label: "Operational replay",
        description: "Inspect recorded incident evidence",
        icon: <History size={19} />,
      },
    ];
  }

  if (role === "OperationsManager") {
    return [
      {
        to: "/overview",
        label: "Operations overview",
        description: "Live work and SLA position",
        icon: <LayoutGrid size={19} />,
      },
      {
        to: "/analytics",
        label: "Analytics",
        description: "Service performance and capacity",
        icon: <BarChart3 size={19} />,
      },
      {
        to: "/work-orders",
        label: "Work orders",
        description: "Review the authorized service queue",
        icon: <ClipboardList size={19} />,
      },
    ];
  }

  if (role === "Analyst") {
    return [
      {
        to: "/analytics",
        label: "Open analytics",
        description: "Explore validated service metrics",
        icon: <BarChart3 size={19} />,
      },
      {
        to: "/analytics#definitions",
        label: "Metric definitions",
        description: "Check what each measure means",
        icon: <ShieldCheck size={19} />,
      },
      {
        to: "/workspaces",
        label: "All workspaces",
        description: "See the areas available to you",
        icon: <LayoutGrid size={19} />,
      },
    ];
  }

  return [
    {
      to: "/administration",
      label: "Administration",
      description: "Identity and workflow standards",
      icon: <Settings2 size={19} />,
    },
    {
      to: "/replay",
      label: "Operational replay",
      description: "Inspect the audit evidence",
      icon: <History size={19} />,
    },
    {
      to: "/analytics",
      label: "Analytics",
      description: "Review platform-wide service metrics",
      icon: <BarChart3 size={19} />,
    },
  ];
}

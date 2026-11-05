import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  ClipboardList,
  History,
  LayoutGrid,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { useAuth } from "../auth";
import type { Role } from "../types";
import { primaryRole, roleLabel, teamLabel } from "../home";

interface Workspace {
  to: string;
  title: string;
  description: string;
  group: string;
  roles: Role[];
  icon: React.ReactNode;
}

const workspaces: Workspace[] = [
  {
    to: "/work-orders",
    title: "Work orders",
    description: "Search, review, and move service requests through their lifecycle.",
    group: "Operations",
    roles: [
      "Technician",
      "Dispatcher",
      "Supervisor",
      "OperationsManager",
      "Administrator",
    ],
    icon: <ClipboardList size={22} />,
  },
  {
    to: "/schedule",
    title: "Dispatch board",
    description: "Plan appointments and match qualified technicians to work.",
    group: "Operations",
    roles: ["Technician", "Dispatcher", "Supervisor", "OperationsManager"],
    icon: <CalendarDays size={22} />,
  },
  {
    to: "/my-jobs",
    title: "My work",
    description: "Open assigned jobs and complete the guided service stages.",
    group: "Operations",
    roles: ["Technician"],
    icon: <Wrench size={22} />,
  },
  {
    to: "/my-jobs",
    title: "Workflow review",
    description: "Review assigned service workflows and completed stage history.",
    group: "Monitoring",
    roles: ["Supervisor", "OperationsManager"],
    icon: <History size={22} />,
  },
  {
    to: "/supervisor",
    title: "SLA monitoring",
    description: "Review at-risk work, overdue stages, and recorded interventions.",
    group: "Monitoring",
    roles: ["Supervisor", "OperationsManager"],
    icon: <TriangleAlert size={22} />,
  },
  {
    to: "/replay",
    title: "Operational replay",
    description: "Investigate the recorded event history without changing operations.",
    group: "Monitoring",
    roles: ["Supervisor", "OperationsManager", "Administrator"],
    icon: <History size={22} />,
  },
  {
    to: "/analytics",
    title: "Analytics",
    description: "Explore validated service performance, capacity, and exports.",
    group: "Insights",
    roles: ["Analyst", "Supervisor", "OperationsManager", "Administrator"],
    icon: <BarChart3 size={22} />,
  },
  {
    to: "/administration",
    title: "Administration",
    description: "Review identity access, workflow standards, and audit boundaries.",
    group: "Administration",
    roles: ["Administrator"],
    icon: <Settings2 size={22} />,
  },
];

export function Workspaces() {
  const auth = useAuth();
  const role = primaryRole(auth.roles);
  const visible = workspaces.filter((workspace) =>
    workspace.roles.some((allowed) => auth.roles.includes(allowed)),
  );
  const groups = [...new Set(visible.map((workspace) => workspace.group))];
  return (
    <div className="workspaces-page">
      <header className="page-heading workspaces-heading">
        <div>
          <h1>Workspaces</h1>
          <p>
            The areas available to {roleLabel(role).toLowerCase()} in{" "}
            {teamLabel(String(auth.user?.profile.team_id ?? auth.user?.profile.teamId ?? ""))}.
          </p>
        </div>
        <span className="workspace-scope">
          <ShieldCheck size={16} aria-hidden="true" />
          Access follows your signed-in role
        </span>
      </header>
      {groups.map((group) => (
        <section className="workspace-group" key={group} aria-labelledby={`group-${group}`}>
          <h2 id={`group-${group}`}>{group}</h2>
          <div className="workspaces-grid">
            {visible
              .filter((workspace) => workspace.group === group)
              .map((workspace) => (
                <Link to={workspace.to} className="workspace-card" key={workspace.to}>
                  <span className="workspace-card-icon">{workspace.icon}</span>
                  <span className="workspace-card-copy">
                    <strong>{workspace.title}</strong>
                    <small>{workspace.description}</small>
                  </span>
                  <ArrowRight size={17} aria-hidden="true" />
                </Link>
              ))}
          </div>
        </section>
      ))}
      {visible.length === 0 && (
        <div className="home-empty">
          <LayoutGrid size={22} aria-hidden="true" />
          <div>
            <strong>No workspace is assigned to this account.</strong>
            <p>Contact your administrator to add the role that matches your work.</p>
          </div>
        </div>
      )}
    </div>
  );
}

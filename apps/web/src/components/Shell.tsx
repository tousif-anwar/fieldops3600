import { useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Compass,
  History,
  Home,
  LayoutGrid,
  LogOut,
  Menu,
  Search,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  Wifi,
  WifiOff,
  Wrench,
  X,
} from "lucide-react";
import { HubConnectionBuilder, LogLevel } from "@microsoft/signalr";
import { api, apiBase } from "../api";
import { manager, useAuth } from "../auth";
import { primaryRole, profileName, roleLabel, teamLabel } from "../home";
import type { Notification, Role } from "../types";

interface NavigationItem {
  to: string;
  label: string;
  icon: typeof Home;
  roles: Role[] | null;
  end?: boolean;
}

const navigationGroups: { label: string; items: NavigationItem[] }[] = [
  {
    label: "Start",
    items: [{ to: "/", label: "Home", icon: Home, roles: null, end: true }],
  },
  {
    label: "Operations",
    items: [
      {
        to: "/work-orders",
        label: "Work orders",
        icon: ClipboardList,
        roles: [
          "Technician",
          "Dispatcher",
          "Supervisor",
          "OperationsManager",
          "Administrator",
        ],
      },
      {
        to: "/schedule",
        label: "Schedule",
        icon: CalendarDays,
        roles: ["Technician", "Dispatcher", "Supervisor", "OperationsManager"],
      },
      {
        to: "/my-jobs",
        label: "My work",
        icon: Wrench,
        roles: ["Technician"],
      },
      {
        to: "/my-jobs",
        label: "Workflow review",
        icon: ClipboardList,
        roles: ["Supervisor", "OperationsManager"],
      },
    ],
  },
  {
    label: "Monitoring",
    items: [
      {
        to: "/supervisor",
        label: "SLA monitoring",
        icon: TriangleAlert,
        roles: ["Supervisor", "OperationsManager"],
      },
      {
        to: "/replay",
        label: "Operational replay",
        icon: History,
        roles: ["Supervisor", "OperationsManager", "Administrator"],
      },
    ],
  },
  {
    label: "Insights",
    items: [
      {
        to: "/analytics",
        label: "Analytics",
        icon: BarChart3,
        roles: ["Analyst", "Supervisor", "OperationsManager", "Administrator"],
      },
      {
        to: "/overview",
        label: "Operations overview",
        icon: Activity,
        roles: [
          "Dispatcher",
          "Supervisor",
          "OperationsManager",
          "Administrator",
        ],
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        to: "/administration",
        label: "Administration",
        icon: Settings2,
        roles: ["Administrator"],
      },
    ],
  },
];

const extraRoutes: { match: RegExp; label: string; to?: string }[] = [
  { match: /^\/workflow\//, label: "Workflow", to: "/my-jobs" },
  { match: /^\/workspaces$/, label: "Workspaces" },
  { match: /^\/notifications$/, label: "Notifications" },
  { match: /^\/auth\//, label: "Sign in" },
];

export function Shell() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("fieldops.navigation.collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [online, setOnline] = useState(navigator.onLine);
  const [query, setQuery] = useState("");
  const [live, setLive] = useState(false);
  const qc = useQueryClient();
  const notificationsAllowed = auth.can(
    "Technician",
    "Dispatcher",
    "Supervisor",
    "OperationsManager",
  );
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<Notification[]>("/api/notifications"),
    enabled: notificationsAllowed,
    refetchInterval: 30000,
  });
  const unread =
    notifications.data?.filter(
      (notification) => !notification.acknowledgedAtUtc,
    ).length ?? 0;
  const role = primaryRole(auth.roles);
  const teamId = String(
    auth.user?.profile.team_id ?? auth.user?.profile.teamId ?? "",
  );
  const name = String(
    auth.user?.profile.name ??
      auth.user?.profile.preferred_username ??
      "Team member",
  );
  const firstName = profileName(
    (auth.user?.profile ?? {}) as Record<string, unknown>,
  );
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
  const canSearch = auth.can(
    "Technician",
    "Dispatcher",
    "Supervisor",
    "OperationsManager",
  );
  const visibleGroups = navigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          item.roles === null ||
          item.roles.some((allowed) => auth.roles.includes(allowed)),
      ),
    }))
    .filter((group) => group.items.length > 0);
  const visibleNavigation = visibleGroups.flatMap((group) => group.items);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(
        "fieldops.navigation.collapsed",
        collapsed ? "1" : "0",
      );
    } catch {
      // Navigation state is a preference; private browsing may reject storage.
    }
  }, [collapsed]);
  useEffect(() => {
    if (!notificationsAllowed) return;
    let active = true;
    const connection = new HubConnectionBuilder()
      .withUrl(`${apiBase}/hubs/notifications`, {
        accessTokenFactory: async () =>
          (await manager.getUser())?.access_token ?? "",
      })
      .withAutomaticReconnect([0, 2000, 5000, 10000])
      .configureLogging(LogLevel.Error)
      .build();
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: ["workflows"] });
      void qc.invalidateQueries({ queryKey: ["reports"] });
    };
    connection.on("notification", refresh);
    connection.on("NotificationReceived", refresh);
    connection.onreconnected(() => {
      if (active) setLive(true);
      refresh();
    });
    connection.onreconnecting(() => {
      if (active) setLive(false);
    });
    connection.onclose(() => {
      if (active) setLive(false);
    });
    void connection
      .start()
      .then(() => {
        if (active) setLive(true);
      })
      .catch(() => {
        if (active) setLive(false);
      });
    return () => {
      active = false;
      void connection.stop();
    };
  }, [qc, notificationsAllowed]);

  const section = visibleNavigation.find(
    (item) =>
      item.to !== "/" &&
      (location.pathname === item.to ||
        location.pathname.startsWith(`${item.to}/`)),
  );
  const extra = extraRoutes.find((item) => item.match.test(location.pathname));
  const detail =
    section &&
    location.pathname !== section.to &&
    !extra?.match.test(location.pathname);
  const crumbs = [
    { label: "Home", to: "/" },
    ...(section
      ? [{ label: section.label, to: section.to }]
      : extra
        ? [{ label: extra.label, to: extra.to }]
        : []),
    ...(detail ? [{ label: "Details", to: undefined }] : []),
  ];
  useEffect(() => {
    const current =
      section?.label ??
      extra?.label ??
      (location.pathname === "/" ? "Home" : "Workspace");
    document.title = `${current} · FieldOps 360`;
  }, [section?.label, extra?.label, location.pathname]);

  function toggleCollapsed() {
    setCollapsed((value) => !value);
  }

  return (
    <div className={`app-layout ${collapsed ? "sidebar-collapsed" : ""}`}>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      {open && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <nav
        aria-label="Main navigation"
        className={`sidebar ${open ? "sidebar-open" : ""}`}
      >
        <div className="sidebar-brand-row">
          <Link to="/" className="brand" aria-label="FieldOps 360 home">
            <span className="brand-symbol">
              <Compass size={23} aria-hidden="true" />
            </span>
            <span className="brand-copy">
              FieldOps <b>360</b>
              <small>Service operations</small>
            </span>
          </Link>
          <button
            className="mobile-close icon-button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div
          className="workspace-switch"
          title={`${teamLabel(teamId)} workspace`}
        >
          <span className="workspace-avatar">
            <Building2 size={18} aria-hidden="true" />
          </span>
          <span className="workspace-switch-copy">
            {teamLabel(teamId)}
            <small>Service operations</small>
          </span>
        </div>
        <div className="primary-navigation">
          {visibleGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  title={collapsed ? label : undefined}
                  className={({ isActive }) =>
                    `nav-item ${isActive ? "active" : ""}`
                  }
                >
                  <Icon size={19} aria-hidden="true" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
          <div className="nav-group nav-group-tools">
            <div className="nav-group-label">Directory</div>
            <NavLink
              to="/workspaces"
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
              title={collapsed ? "All workspaces" : undefined}
            >
              <LayoutGrid size={19} aria-hidden="true" />
              <span>All workspaces</span>
            </NavLink>
          </div>
        </div>
        <div className="sidebar-bottom">
          <button
            className="sidebar-toggle"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            title={collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            <span>{collapsed ? "Expand" : "Collapse navigation"}</span>
          </button>
          <span className="sidebar-security">
            <ShieldCheck size={15} aria-hidden="true" />
            <span>Server-authorized access</span>
          </span>
        </div>
      </nav>
      <div className="workspace-main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu icon-button"
              aria-label="Open navigation"
              onClick={() => setOpen(true)}
            >
              <Menu size={21} />
            </button>
            <nav className="breadcrumb" aria-label="Breadcrumb">
              {crumbs.map((crumb, index) => {
                const last = index === crumbs.length - 1;
                return (
                  <span key={`${crumb.label}-${index}`}>
                    {index > 0 && <span className="crumb-separator">/</span>}
                    {last || !crumb.to ? (
                      <strong aria-current={last ? "page" : undefined}>
                        {crumb.label}
                      </strong>
                    ) : (
                      <Link to={crumb.to}>{crumb.label}</Link>
                    )}
                  </span>
                );
              })}
            </nav>
          </div>
          <div className="topbar-right">
            {canSearch && (
              <form
                className="global-search"
                role="search"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (query.trim()) {
                    navigate(
                      `/work-orders?q=${encodeURIComponent(query.trim())}`,
                    );
                  }
                }}
              >
                <Search size={16} aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search work orders"
                  aria-label="Search work orders"
                />
                <kbd>Enter</kbd>
              </form>
            )}
            {import.meta.env.DEV && (
              <span className="environment-badge">Local</span>
            )}
            <span
              className={`connection ${!online ? "offline" : ""}`}
              aria-label={
                online
                  ? live
                    ? "Live updates connected"
                    : "Updates polling"
                  : "Offline"
              }
            >
              {online ? <Wifi size={14} /> : <WifiOff size={14} />}
              <span>{online ? (live ? "Live" : "Polling") : "Offline"}</span>
            </span>
            {notificationsAllowed && (
              <NavLink
                to="/notifications"
                className="notification-button icon-button"
                aria-label={`Notifications, ${unread} unread`}
              >
                <Bell size={20} />
                {unread > 0 && <span>{unread > 9 ? "9+" : unread}</span>}
              </NavLink>
            )}
            <details className="user-menu">
              <summary
                className="user-summary"
                aria-label={`Account menu for ${name}`}
              >
                <span className="avatar">
                  {initials || firstName.slice(0, 2).toUpperCase()}
                </span>
                <span className="user-summary-copy">
                  <strong>{name}</strong>
                  <small>{roleLabel(role)}</small>
                </span>
                <ChevronDown size={15} aria-hidden="true" />
              </summary>
              <div className="user-popover">
                <div className="user-popover-identity">
                  <strong>{name}</strong>
                  <span>{String(auth.user?.profile.email ?? "")}</span>
                  <small>
                    {roleLabel(role)} · {teamLabel(teamId)}
                  </small>
                </div>
                <Link to="/workspaces" className="user-popover-link">
                  <LayoutGrid size={16} aria-hidden="true" />
                  All workspaces
                </Link>
                {notificationsAllowed && (
                  <Link to="/notifications" className="user-popover-link">
                    <Bell size={16} aria-hidden="true" />
                    Notifications
                  </Link>
                )}
                <button
                  className="user-popover-signout"
                  onClick={() => void auth.logout()}
                >
                  <LogOut size={16} aria-hidden="true" />
                  Sign out
                </button>
              </div>
            </details>
          </div>
        </header>
        {!online && (
          <div className="offline-banner" role="status">
            <WifiOff size={16} />
            You’re offline. Saved drafts remain on this device. Reconnect before
            submitting.
          </div>
        )}
        <main id="main" className="page-content">
          <Outlet />
        </main>
        <footer className="workspace-footer">
          <span>FieldOps 360 · Service operations</span>
          <span>
            Server-authorized workflows{" "}
            <ShieldCheck size={13} aria-hidden="true" />
          </span>
        </footer>
      </div>
    </div>
  );
}

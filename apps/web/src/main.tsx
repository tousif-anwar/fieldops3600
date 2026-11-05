import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { AuthProvider, useAuth } from "./auth";
import { Shell } from "./components/Shell";
import { ErrorState, Loading } from "./components/common";
import { Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { lazy, Suspense, useMemo, type ReactNode } from "react";
import type { Role } from "./types";
import "./styles.css";
import "./enterprise.css";

const Overview = lazy(() =>
  import("./pages/Overview").then((m) => ({ default: m.Overview })),
);
const WorkOrders = lazy(() =>
  import("./pages/WorkOrders").then((m) => ({ default: m.WorkOrders })),
);
const CreateOrder = lazy(() =>
  import("./pages/WorkOrders").then((m) => ({ default: m.CreateOrder })),
);
const OrderDetails = lazy(() =>
  import("./pages/WorkOrders").then((m) => ({ default: m.OrderDetails })),
);
const Schedule = lazy(() =>
  import("./pages/Schedule").then((m) => ({ default: m.Schedule })),
);
const MyJobs = lazy(() =>
  import("./pages/Workflow").then((m) => ({ default: m.MyJobs })),
);
const WorkflowPage = lazy(() =>
  import("./pages/Workflow").then((m) => ({ default: m.WorkflowPage })),
);
const Analytics = lazy(() =>
  import("./pages/Analytics").then((m) => ({ default: m.Analytics })),
);
const ReplayPage = lazy(() =>
  import("./pages/Replay").then((m) => ({ default: m.ReplayPage })),
);
const Notifications = lazy(() =>
  import("./pages/Notifications").then((m) => ({ default: m.Notifications })),
);
const Administration = lazy(() =>
  import("./pages/Administration").then((m) => ({ default: m.Administration })),
);
const Workspaces = lazy(() =>
  import("./pages/Workspaces").then((m) => ({ default: m.Workspaces })),
);

function SessionQueries() {
  const { user } = useAuth();
  // A new authenticated identity receives a separate cache. A prior user's data
  // cannot appear briefly while protected requests for the next user load.
  const client = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15000,
            retry: (count, error) =>
              !(
                "status" in error &&
                (error.status === 401 || error.status === 403)
              ) && count < 1,
            refetchOnWindowFocus: true,
          },
          mutations: { retry: false },
        },
      }),
    [user?.profile.sub],
  );
  return (
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  );
}
const theme = {
  ...webLightTheme,
  colorBrandBackground: "#1f5aa6",
  colorBrandBackgroundHover: "#194b8c",
  colorBrandBackgroundPressed: "#143c70",
  colorBrandForeground1: "#1f5aa6",
  borderRadiusMedium: "6px",
  borderRadiusLarge: "8px",
  fontFamilyBase:
    '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif',
  fontSizeBase100: "12px",
  fontSizeBase200: "13px",
  fontSizeBase300: "14px",
  fontSizeBase400: "16px",
  fontSizeBase500: "20px",
  fontSizeBase600: "24px",
  lineHeightBase300: "20px",
  lineHeightBase400: "24px",
  lineHeightBase500: "28px",
};
function RequireRole({
  roles,
  children,
}: {
  roles: Role[];
  children: ReactNode;
}) {
  const auth = useAuth();
  return auth.can(...roles) ? (
    children
  ) : (
    <ErrorState
      error={
        new Error(
          "Your account does not have permission to open this workspace. Contact your administrator if you need access.",
        )
      }
    />
  );
}
function App() {
  const auth = useAuth();
  if (!auth.ready) return <Loading label="Checking your secure session…" />;
  if (!auth.user) return <Login />;
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="workspaces" element={<Workspaces />} />
          <Route
            path="overview"
            element={
              <RequireRole roles={["Dispatcher", "Supervisor", "OperationsManager"]}>
                <Overview />
              </RequireRole>
            }
          />
          <Route
            path="work-orders"
            element={
              <RequireRole
                roles={[
                  "Technician",
                  "Dispatcher",
                  "Supervisor",
                  "OperationsManager",
                ]}
              >
                <WorkOrders />
              </RequireRole>
            }
          />
          <Route
            path="work-orders/new"
            element={
              <RequireRole roles={["Dispatcher", "OperationsManager"]}>
                <CreateOrder />
              </RequireRole>
            }
          />
          <Route
            path="work-orders/:id"
            element={
              <RequireRole
                roles={[
                  "Technician",
                  "Dispatcher",
                  "Supervisor",
                  "OperationsManager",
                ]}
              >
                <OrderDetails />
              </RequireRole>
            }
          />
          <Route
            path="schedule"
            element={
              <RequireRole
                roles={[
                  "Technician",
                  "Dispatcher",
                  "Supervisor",
                  "OperationsManager",
                ]}
              >
                <Schedule />
              </RequireRole>
            }
          />
          <Route
            path="my-jobs"
            element={
              <RequireRole
                roles={[
                  "Technician",
                  "Dispatcher",
                  "Supervisor",
                  "OperationsManager",
                ]}
              >
                <MyJobs />
              </RequireRole>
            }
          />
          <Route
            path="workflow/:id"
            element={
              <RequireRole
                roles={[
                  "Technician",
                  "Dispatcher",
                  "Supervisor",
                  "OperationsManager",
                ]}
              >
                <WorkflowPage />
              </RequireRole>
            }
          />
          <Route
            path="supervisor"
            element={
              <RequireRole roles={["Supervisor", "OperationsManager"]}>
                <Overview supervisor />
              </RequireRole>
            }
          />
          <Route
            path="analytics"
            element={
              <RequireRole
                roles={["Analyst", "Supervisor", "OperationsManager", "Administrator"]}
              >
                <Analytics />
              </RequireRole>
            }
          />
          <Route
            path="replay"
            element={
              <RequireRole
                roles={["Supervisor", "OperationsManager", "Administrator"]}
              >
                <ReplayPage />
              </RequireRole>
            }
          />
          <Route path="notifications" element={<Notifications />} />
          <Route
            path="administration"
            element={
              <RequireRole roles={["Administrator"]}>
                <Administration />
              </RequireRole>
            }
          />
          <Route path="auth/callback" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <FluentProvider theme={theme}>
    <BrowserRouter>
      <AuthProvider>
        <SessionQueries />
      </AuthProvider>
    </BrowserRouter>
  </FluentProvider>,
);

import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { AuthProvider, useAuth } from "./auth";
import { Shell } from "./components/Shell";
import { ErrorState, Loading } from "./components/common";
import { Login } from "./pages/Login";
import { lazy, Suspense, useMemo, type ReactNode } from "react";
import type { Role } from "./types";
import "./styles.css";

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
  colorBrandBackground: "#285fb7",
  colorBrandBackgroundHover: "#204e99",
  colorBrandBackgroundPressed: "#173f82",
  colorBrandForeground1: "#285fb7",
  borderRadiusMedium: "7px",
  fontFamilyBase: '"Segoe UI", system-ui, sans-serif',
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
          <Route index element={<Overview />} />
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
                roles={["Analyst", "Supervisor", "OperationsManager"]}
              >
                <Analytics />
              </RequireRole>
            }
          />
          <Route
            path="replay"
            element={
              <RequireRole roles={["Supervisor", "OperationsManager"]}>
                <ReplayPage />
              </RequireRole>
            }
          />
          <Route path="notifications" element={<Notifications />} />
          <Route
            path="administration"
            element={
              <RequireRole roles={[]}>
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

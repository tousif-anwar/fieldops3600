# User journeys

**Basis:** route transitions visible in the baseline application at `86c15a8` and in the implemented application. Counts are derived from the UI and routes, not from timed observation of users. “Before” counts are reconstructions from the baseline navigation; “after” counts were exercised by the live browser suite where noted.

## Technician

**Primary question:** what job should I work on next?

| | Before | After |
| --- | --- | --- |
| 1 | Sign in → shared overview | Sign in → Technician Home |
| 2 | Sidebar → My workflow | Review current job, stage, SLA in the snapshot |
| 3 | Choose assigned job | Continue / Review from “Needs attention” or “My work” |
| 4 | Open workflow stage | Complete the stage in the guided workflow |

Route transitions from Home to the current stage: **1 click** (“Continue” / job row) plus the stage action. Before, the shortest path was landing → My workflow → job → stage: **3 clicks** after sign-in. Home now also exposes unread notices and the assigned-work list.

Completion feedback, stage validation, server rejection handling, and assistance requests are unchanged.

## Dispatcher

**Primary question:** what needs to be dispatched?

| | Before | After |
| --- | --- | --- |
| 1 | Sign in → shared overview | Sign in → Dispatcher Home |
| 2 | Read generic KPIs | Read unassigned, today’s bookings, active technicians |
| 3 | Sidebar → Schedule | Click **Assign** on an unassigned request |
| 4 | Choose work order and time manually | Dispatch board opens with the work order preselected (`?workOrderId=`) |
| 5 | Request recommendations, choose technician, confirm | Same recommendation, override reason, and confirmation flow |

Home “Assign” removes the need to re-select the work order on the dispatch board. Creating a work order remains one click from Quick access. The server still enforces qualifications and overlapping-booking constraints.

## Supervisor

**Primary question:** what needs intervention?

| | Before | After |
| --- | --- | --- |
| 1 | Sign in → shared overview | Sign in → Supervisor Home |
| 2 | Scan generic active/overdue counts | See at-risk, overdue, and unread alert counts |
| 3 | Navigate to overview or workflow list | Pick a risky stage from “Needs attention” |
| 4 | Locate the workflow | Open the workflow directly (`/workflow/:id`) or open SLA monitoring |
| 5 | Investigate and record an intervention | Same existing intervention controls |

Home lists at most five risks, ordered by breach severity. “Recent alerts” provides the latest team notices without turning Home into a notification centre. Replay remains available for evidence review.

## Operations Manager

**Primary question:** how are operations performing?

| | Before | After |
| --- | --- | --- |
| 1 | Sign in → shared overview | Sign in → Manager Home |
| 2 | Read a dense wall of KPIs and recent orders | Read three figures: completion, SLA compliance, active jobs with risk context |
| 3 | Open overview or analytics | Investigate an exception from “Needs attention” |
| 4 | Choose a report or team view | Open Operations overview, Analytics, or technician capacity |

Capacity is shown only when published working hours and bookings exist. An unknown utilization is rendered as “Unknown capacity” with an em dash; it is never coerced to zero.

## Analyst

**Primary question:** where should I begin analyzing?

| | Before | After |
| --- | --- | --- |
| 1 | Sign in → shared overview | Sign in → Analyst Home |
| 2 | Sidebar → Analytics | Choose SLA performance, stage durations, or service mix |
| 3 | Choose filters inside the report | Analytics opens with filters and definitions available |
| 4 | Interpret charts | Charts have accessible data tables and a definitions section |

The Analyst Home does not query work orders, notifications, or dispatch data. It shows warehouse scope, freshness, and reporting coverage only.

## Administrator

**Primary question:** what needs configuration or attention?

| | Before | After |
| --- | --- | --- |
| 1 | Sign in → shared overview | Sign in → Administrator Home |
| 2 | Find administration in the sidebar | See administration areas, audit evidence, and service performance |
| 3 | Open a configuration screen | Open Administration, Operational replay, or Analytics directly |
| 4 | Review or change configuration | Existing screens and confirmation behaviour apply |

No fake “system health” or configuration controls were added. The identity provider remains Keycloak; Administration explains the boundary and links to the real capabilities that exist.

## Cross-role flows

### Protected deep link

1. Unauthenticated user opens `/work-orders?status=Created`.
2. Secure entry screen appears. No operational data renders.
3. User continues to Keycloak; the requested path and query are stored in the PKCE state.
4. Callback completes, `AuthProvider` navigates to the stored path, and the guard checks the role.
5. Work orders render with the status filter applied.

Verified by `apps/web/e2e/roles.spec.ts` (“a protected deep link survives reauthentication and retains its query”).

### Unauthorized deep link

1. Analyst opens `/administration`.
2. After sign-in, the route guard renders an explicit “does not have permission” state.
3. The Administration heading and controls are never rendered.

Verified by the live browser suite. Backend authorization remains authoritative if a request is attempted directly.

### Missing role

A valid identity with no recognized FieldOps 360 role reaches an explicit “Access not configured” Home. It explains that access is not inferred from another directory group and offers sign-out. No workspace links are shown.

### Multiple roles

`primaryRole()` resolves by priority: Administrator → OperationsManager → Supervisor → Dispatcher → Technician → Analyst. Home uses the highest operational responsibility; additional roles are listed as “Also authorized”. Navigation includes the union of role-permitted destinations.

### Refresh and sign-out

Tokens are held in memory by design. A full page reload requires reauthentication through the existing Keycloak session; the original deep link is preserved. Sign-out clears the OIDC user and returns to the secure entry screen. This is existing security behaviour, not a regression.

## Click-count summary

| Role | Before: sign-in → primary task | After: sign-in → primary task | Notes |
| --- | --- | --- | --- |
| Technician | 3 | 1–2 | Home current job opens the workflow; stage action remains. |
| Dispatcher | 3–4 | 1–2 | Home Assign preselects the work order on the dispatch board. |
| Supervisor | 2–3 | 1–2 | Home risk row opens the workflow or SLA workspace. |
| Manager | 2 | 1 | Home links directly to overview, analytics, or capacity. |
| Analyst | 2 | 1 | Home reporting area opens Analytics. |
| Administrator | 2 | 1 | Home opens the relevant administrative workspace. |

No task-time measurements are claimed. A comparative study with real users would be required to state time savings.

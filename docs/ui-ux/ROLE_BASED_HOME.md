# Role-based Home

## Implementation

| Concern | Location |
| --- | --- |
| Role priority, labels, greeting, risk ordering, destinations | `apps/web/src/home.ts` |
| Six Home compositions and no-role state | `apps/web/src/pages/Home.tsx` |
| Route (`/`) and guards | `apps/web/src/main.tsx` |
| Role extraction and post-login return path | `apps/web/src/auth.tsx` |
| Shared shell, navigation, notifications, account menu | `apps/web/src/components/Shell.tsx` |
| Visual layer | `apps/web/src/enterprise.css` |
| Role matrix and routing tests | `apps/web/e2e/roles.spec.ts` |
| Model tests | `apps/web/src/test/home.test.ts`, `auth.test.ts` |

Home is the index route. A normal sign-in therefore lands on `/`; a protected deep link returns to its stored path instead.

## Shared structure

Every role Home uses the same shell and a small set of patterns:

1. **Context line** — role and team, with a status dot.
2. **Greeting** — time-aware, first name only.
3. **Role summary** — one sentence describing the role's responsibility.
4. **Snapshot** — exactly three figures relevant to the role.
5. **Attention panel** — the role's priority work, at most five rows.
6. **Quick access** — at most three task shortcuts.
7. **One secondary panel** — assigned work, upcoming appointments, recent alerts, capacity, or reporting coverage.

Home never repeats the full sidebar, shows a hero illustration, or renders a chart wall.

## Role compositions

### Technician — “What job should I work on next?”

| Element | Content | Source |
| --- | --- | --- |
| Snapshot | Current job, current stage, stage SLA and deadline | `/api/work-orders`, `/api/workflows` |
| Needs attention | Unread notices (max 2) and a warning/critical/breached current stage | `/api/notifications`, workflow stage |
| Quick access | My work, My schedule, Alerts | Client routes |
| Secondary | Assigned open jobs, current job first | `/api/work-orders`, bookings |
| Primary destination | `/my-jobs` | |

The primary action is **Continue** (or **Review** when breached) from the current-stage row. Analytics and administration are absent.

### Dispatcher — “What needs to be dispatched?”

| Element | Content | Source |
| --- | --- | --- |
| Snapshot | Unassigned count, today’s confirmed bookings, active technicians | `/api/work-orders`, `/api/bookings`, `/api/technicians` |
| Needs attention | Unassigned requests, sorted Critical → High → Normal → Low, with **Assign** | `/api/work-orders` |
| Quick access | Work orders, Dispatch board, Create work order | Client routes |
| Secondary | Upcoming confirmed appointments with technician and status | `/api/bookings`, `/api/technicians` |
| Primary destination | `/work-orders?status=Created` | |

Assign links to `/schedule?workOrderId=…` so the dispatch board opens with the request selected.

### Supervisor — “What needs intervention?”

| Element | Content | Source |
| --- | --- | --- |
| Snapshot | At risk, overdue, unread alerts | `/api/workflows`, `/api/notifications` |
| Needs attention | Non-completed workflows with Warning/Critical/Breached stages, most severe first | `/api/workflows`, `/api/work-orders`, `/api/technicians` |
| Quick access | SLA monitoring, Work orders, Operational replay | Client routes |
| Secondary | Latest team alerts with unread/acknowledged state | `/api/notifications` |
| Primary destination | `/supervisor` | |

A paused stage is shown as **Paused** rather than its last SLA status. Rows open the workflow detail for investigation.

### Operations Manager — “How are operations performing?”

| Element | Content | Source |
| --- | --- | --- |
| Snapshot | Completion rate, SLA compliance, active jobs with at-risk/overdue detail | `/api/reports/summary` |
| Needs attention | Same exception model as Supervisor | `/api/workflows`, `/api/work-orders` |
| Quick access | Operations overview, Analytics, Work orders | Client routes |
| Secondary | Technician capacity, only when utilization exists | `/api/reports/summary` |
| Primary destination | `/overview` | |

A null metric renders as `—`, not `0`. Unknown utilization shows “Unknown capacity” and an em dash.

### Analyst — “Where should I begin analyzing?”

| Element | Content | Source |
| --- | --- | --- |
| Snapshot | Work orders, SLA compliance, warehouse freshness | `/api/reports/summary` |
| Start an analysis | SLA performance, stage durations, service mix | Client routes |
| Quick access | Open analytics, Metric definitions, All workspaces | Client routes |
| Secondary | Reporting coverage by service category | `/api/reports/summary` |
| Primary destination | `/analytics` | |

The Analyst Home deliberately does not query work orders, notifications, or dispatch data, and the notification bell is not rendered for this role.

### Administrator — “What needs configuration or attention?”

| Element | Content | Source |
| --- | --- | --- |
| Snapshot | Access scope, audit evidence availability, identity provider | Existing configuration/role context |
| Administration areas | Identity and access, audit evidence, service performance | Client routes |
| Quick access | Administration, Operational replay, Analytics | Client routes |
| Primary destination | `/administration` | |

The snapshot describes real platform boundaries; it does not claim a live system-health feed. No fake configuration toggles were added.

## No-role state

A valid identity with no recognized realm role sees:

- “Access not configured”
- A greeting and an explanation that no FieldOps 360 role is assigned
- A statement that access is not inferred from another directory group
- A sign-out action

No operational links or data queries render.

## Multiple roles

`primaryRole()` uses this priority:

1. Administrator
2. OperationsManager
3. Supervisor
4. Dispatcher
5. Technician
6. Analyst

The highest operational responsibility determines Home content and destination. Other recognized roles appear as “Also authorized: …”. Navigation uses the union of assigned roles, not the primary role alone. The unknown-role state is shown only when the filtered role list is empty.

## Loading, empty, and error states

| State | Behaviour |
| --- | --- |
| Loading | Snapshot values show `—`; the attention panel shows a labelled loading state. No guessed zeros. |
| Empty | Role-specific explanation of what will appear, not a blank card. |
| Error | Existing `ErrorState` with retry; the shell and navigation remain usable. |
| Partial data | Each query is enabled only for roles that need it; a failed report query does not block technician work. |
| Offline | Shell banner explains that drafts remain local and submitting requires a connection. |
| Null metric | `—` plus an explanatory detail; never coerced to a number. |

## Routing and authentication

### Normal login

1. Unauthenticated user sees the secure entry screen.
2. `AuthProvider` starts PKCE and stores the current path, query, and hash in the OIDC state.
3. Keycloak redirects to `/auth/callback`.
4. The callback route renders a loading state only; it does not navigate on its own.
5. `AuthProvider` completes the callback, validates that the return path is same-origin and begins with `/`, and navigates there.
6. `RequireRole` evaluates after `auth.ready`, preventing unauthorized content from flashing.
7. `/` renders Home; any other authorized path renders its workspace.

### Security properties

- Roles are read from the signed access token's `realm_access.roles`; the API validates the token independently.
- Tokens are stored in memory (`InMemoryWebStorage`), not local storage. A full reload requires reauthentication.
- Only the short-lived PKCE transaction and return path use `sessionStorage`.
- The return path rejects `//` and backslash variants to prevent open redirects.
- Client-side navigation filtering is not an authorization boundary; server endpoints still enforce access.
- The Administrator override exists in `can()` for route access, but the sidebar is filtered by assigned role so it does not advertise technician-only work.

## Native technician Home

`apps/technician-mobile/app/(tabs)/index.tsx` applies the same priority order in a native layout:

- Greeting and current job.
- Current workflow stage and SLA warning.
- Offline/sync status from the existing provider.
- Assistance and supervisor notices.
- Upcoming assigned jobs.
- Large touch targets and native tab navigation; the web sidebar is not reproduced.

The tab formerly labeled “Jobs” is now **Home**. `greetingFor()` lives in `apps/technician-mobile/src/ui/model.ts` and is covered by `tests/mobile/ui-model.test.ts`.

## Evidence

- `docs/ui-ux/evidence/after-home-technician.png`
- `after-home-dispatcher.png`
- `after-home-supervisor.png`
- `after-home-manager.png`
- `after-home-analyst.png`
- `after-home-administrator.png`
- `after-responsive-320.png`, `after-responsive-768.png`

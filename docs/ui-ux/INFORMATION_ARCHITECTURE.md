# Information architecture

## Three levels

| Level | Purpose | Examples |
| --- | --- | --- |
| 1. Home | Orient the user, answer “what needs me now?”, provide a small set of next actions. | `/` with six role variants and a no-role state. |
| 2. Workspace | Organize a major responsibility and support scanning, filtering, and navigation into work. | Work orders, Dispatch board, SLA monitoring, Analytics, Administration, All workspaces. |
| 3. Task / detail | Complete or inspect one record without losing context. | Work-order detail, create work order, workflow stage, booking editor, replay event, metric definition. |

The shell is shared across all three levels. Home is not a dashboard with every metric; it is a launch point with a small, role-specific attention model.

## Before and after

| Before | After | Reason |
| --- | --- | --- |
| Overview (single shared landing) | Home + Operations overview | Home answers role-specific “what now?”; the operational overview remains available as a workspace. |
| My workflow | My work (Technician) / Workflow review (Supervisor, Operations Manager) | Same route, different task intent and vocabulary. |
| Flat sidebar with four items | Start, Operations, Monitoring, Insights, Administration, Directory | Grouping reduces scan cost and exposes monitoring separately from daily work. |
| No workspace directory | All workspaces | Supports discovery without expanding every group in the sidebar. |
| Service-shaped labels | Task-shaped labels | Users predict destinations from the label, not the backend service map. |
| No breadcrumbs | Home / Workspace / Details | Location and back-navigation are explicit on deeper pages. |

## Sitemap

```text
/                          Home (all authenticated roles)
/workspaces                All workspaces (all authenticated roles)
/overview                  Operations overview
/work-orders               Work orders (list, URL-backed filters, pagination)
/work-orders/new           Create work order
/work-orders/:id           Work order detail
/schedule                  Dispatch board (schedule and booking)
/my-jobs                   My work (Technician) / Workflow review (Supervisor, Manager)
/workflow/:id              Workflow task and stage history
/supervisor                SLA monitoring
/analytics                 Analytics (filters, tabs, definitions, exports)
/replay                    Operational replay (read-only)
/notifications             Notifications
/administration            Administration
/auth/callback             PKCE completion only; no page content
*                          Redirect to Home
```

## Role and navigation matrix

`Manager` in the demo realm is the `OperationsManager` application role.

| Destination | Technician | Dispatcher | Supervisor | Operations Manager | Analyst | Administrator |
| --- | --- | --- | --- | --- | --- | --- |
| Home | Yes | Yes | Yes | Yes | Yes | Yes |
| Work orders | Yes | Yes | Yes | Yes | — | Yes |
| Schedule | Yes | Yes | Yes | Yes | — | — (nav hidden; route guard allows the Administrator override) |
| My work | Yes | — (route allowed) | — | — | — | — |
| Workflow review | — | — | Yes | Yes | — | — |
| SLA monitoring | — | — | Yes | Yes | — | — (route guard allows override) |
| Operational replay | — | — | Yes | Yes | — | Yes |
| Analytics | — | — | Yes | Yes | Yes | Yes |
| Operations overview | — | Yes | Yes | Yes | — | Yes |
| Administration | — | — | — | — | — | Yes |
| All workspaces | Yes | Yes | Yes | Yes | Yes | Yes |
| Notifications (bell) | Yes | Yes | Yes | Yes | — (API not queried) | — (API not queried) |

Navigation visibility is computed from the user's assigned realm roles. Route guards use the shared `can()` helper, which includes the existing Administrator override; the backend remains the authority for every request. The two mechanisms intentionally differ for Administrator-only shortcuts, and the sidebar does not advertise workspaces outside the Administrator's day-to-day role.

## Navigation model

- **Start:** Home only.
- **Operations:** Work orders, Schedule, My work or Workflow review.
- **Monitoring:** SLA monitoring, Operational replay.
- **Insights:** Analytics, Operations overview.
- **Administration:** Administration (Administrator only).
- **Directory:** All workspaces (always available).

Rules:

1. A group is hidden when the role has no item in it.
2. Active state is based on the current route, not on a manually stored selection.
3. Collapsing the sidebar persists as a local preference; it does not change authorization.
4. On screens at or below 900 px, navigation becomes an off-canvas drawer with a labelled open/close control and a scrim.
5. Breadcrumbs appear on workspace and detail routes; Home is not given a redundant breadcrumb trail beyond its own current-page marker.

## URL and state ownership

| State | Owner | Reason |
| --- | --- | --- |
| Work-order search, status, priority, page | URL query string | Linkable, refresh-safe, restored by deep-link authentication. |
| Selected work order for dispatch | `workOrderId` query parameter | Home “Assign” and upcoming appointments link directly to the relevant booking context. |
| Analytics tab | Component state | The tab is a view of the current report, not a separate record; filters remain in the workspace. |
| Sidebar collapsed | `localStorage` preference | Non-sensitive UI preference only. |
| Identity, roles, access token | In-memory OIDC user | Tokens are not persisted to local storage. A full reload deliberately requires reauthentication. |
| PKCE transaction and return path | `sessionStorage` | Short-lived, cleared by the OIDC library; allows a protected deep link to return after sign-in. |

## Label conventions

- Use sentence case for navigation and headings.
- Prefer verbs or concrete nouns: “Create work order”, “Review conflicts”, “Continue job”.
- Avoid internal service names, environment jargon, and unexplained abbreviations.
- Keep “SLA” because it is the domain term used by the product and its users; define it in Analytics rather than renaming it.
- Status labels always include text; colour is supplementary.

## Unsupported or intentionally absent destinations

No favourites, saved views, custom dashboards, role impersonation, or configuration editors were added. The backend does not expose those capabilities, and a placeholder would violate the “no mock pages” constraint.

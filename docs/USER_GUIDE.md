# User Guide

## Signing in

Open <http://localhost:8088> and choose **Continue to secure sign-in**. The browser completes a Keycloak Authorization Code + PKCE flow and returns to the requested page. The demo usernames and password location are described in [Installation and setup](INSTALLATION_AND_SETUP.md).

The Home page is role-aware. Navigation only shows workspaces your signed role can use. A direct link to an unauthorized workspace shows a permission message; the backend also rejects the corresponding API request.

## Technician

### Home and My work

The Home page summarizes assigned work and notifications. **My work** lists confirmed assignments with the work-order number, customer, site, priority, and stage completion. An order without a workflow shows **Start service workflow**; a started workflow shows **Continue service**.

### Completing a stage

1. Open the assigned workflow.
2. Review the stage instructions and stage timer.
3. Answer every required field. Conditional fields appear only when their controlling answer matches.
4. Use **Save draft** if you need to pause data entry on this device.
5. Submit with **Submit & continue**. The server validates the expected version and idempotency key.
6. Completed stages become read-only. Use the step list to review recorded answers.
7. On the final stage, choose **Complete service**.

If the connection is unavailable, the web client keeps a local draft and the action button explains that the server is required. The mobile app provides the durable offline queue.

### Assistance and pauses

Use **Request supervisor assistance** when the available answers do not describe the situation. A supervisor can pause or resume the stage with a recorded reason. A paused stage keeps its evidence and does not pretend the timer is running.

### Equipment context

If the job is linked to a registered asset, the workflow can show the equipment identity, warranty status, and the technician's authorized service history for that asset. A technician cannot use the office-only asset reference endpoint or read another technician's unassigned work.

## Dispatcher

### Create a service request

1. Open **Work orders** and choose **New request**.
2. Select a registered customer and location, or provide the unregistered-customer reason required by the form.
3. Choose the service category and priority.
4. Submit. The request appears in the team's work list.

The customer and equipment registries are available to dispatchers, supervisors, and operations managers. Use the registry history to review prior changes rather than overwriting evidence.

### Schedule a request

1. Open an unassigned work order.
2. Choose **Schedule** or open the scheduling board.
3. Select a date/time and duration.
4. Request **Baseline** for a deterministic workload ranking or **OR-Tools optimization** for CP-SAT.
5. Review the candidate explanations, qualifications, workload, and travel proxy.
6. Confirm a technician to create the booking.

A recommendation does not reserve the slot. Confirmation revalidates the technician and can return `409` if another dispatcher won the race. Reschedule or cancel through the booking controls; cancellation requires a reason.

### Conflict recovery

If no candidate is available, check:

- the requested time is inside the technician's local working hours;
- the technician has the required skills and certifications;
- approved time off does not overlap;
- a confirmed booking does not overlap;
- the appointment fits within one UTC service day.

Do not create a second confirmed booking for the same work order. The database enforces one confirmed booking per order.

## Supervisor

### Operational overview

The Supervisor overview highlights active work, at-risk stages, overdue stages, and escalations. Use the workflow view to inspect stage timing and answers.

### Interventions

Every intervention requires a reason and appears in the audit stream:

- **Approve pause**: stops the effective stage clock while preserving prior evidence.
- **Resume stage**: restarts the clock after an approved pause.
- **Override stage**: advances exactly one stage. It is not a way to skip the final form.
- **Assistance**: records a technician request for supervisor attention.

The UI and API use optimistic versions. If another user changed the workflow, reload before retrying.

### Operational Replay

Open **Replay**, select a work order, and review:

- the ordered event timeline;
- causation and correlation identifiers;
- delivery attempts and retries;
- integrity verification;
- the reconstructed workflow state and incident summary;
- trace availability;
- CSV/PDF evidence exports.

Replay is read-only. The projection rebuild is Administrator-only and does not delete immutable evidence.

### Analytics

Supervisors can open Analytics. Use the report scope controls, review metric definitions and freshness, and export the order-level CSV/PDF when needed. The warehouse is eventually consistent; a blank metric may mean the population is empty, not that the value is zero.

## Operations Manager

The Manager Home and Analytics workspace focus on operational KPIs, service performance, workforce utilization, category mix, completion, and SLA trends. The manager can open Replay; the backend policy includes the Operations Manager role.

Contract entitlements and installation permits are not first-class features. Create the operational work order and schedule it through the standard qualified path.

## Analyst

Analysts use the Analytics workspace and registry coverage reports. They can:

- review completion, SLA, stage-duration, escalation, category, and utilization metrics;
- inspect definitions, data source, and freshness;
- export order-level CSV/PDF reports;
- review customer/asset coverage without names, addresses, or operational mutation access.

Analysts cannot create work orders, execute workflows, acknowledge operational alerts, or read Replay evidence. Dispatchers also do not have the Analytics navigation item in this release.

## Administrator

The Administration page explains identity/configuration boundaries and links to Keycloak. It does not expose secrets or pretend to be a full visual workflow-template editor.

Administrators can rebuild replay projections. This operation reads immutable audit events and refreshes the read projection; it does not rewrite history.

## Customer portal status

A customer login, customer-initiated request wizard, appointment tracking, contract entitlement validation, and customer notifications are **not implemented**. Customer and location records are maintained by the operational team. Do not demonstrate a customer portal as if it exists; use the dispatcher path for the service-request portion of a demonstration.

## Common messages

| Message | Meaning |
|---|---|
| “Your account does not have permission…” | The signed role is not allowed to open this workspace. |
| “This work order cannot be scheduled…” | The order is completed, cancelled, or in progress. |
| “Choose baseline or optimized dispatch.” | The strategy value is invalid. |
| “The optimizer is unavailable…” | The private optimizer is not reachable; baseline can still run. |
| “A confirmed booking already exists…” | Cancel or reschedule the existing booking first. |
| “The stage changed…” | Reload the workflow; your version is stale. |
| “No authorized trace metadata…” | The trace is not linked to this work order or is not available. |

Use the server message rather than retrying blindly. The API is the source of truth for role, scope, version, and lifecycle decisions.

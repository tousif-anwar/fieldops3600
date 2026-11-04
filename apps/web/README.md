# FieldOps 360 operations web

The operations application uses React, TypeScript, Vite, Fluent UI, TanStack Query, React Router, React Hook Form, Zod, Recharts, and SignalR. Screens display actual authorized API responses. Loading, empty, offline, validation, authorization, and service-error states are explicit; failures never fall back to fabricated operational records.

## Run locally

Start the infrastructure, identity provider, six backend services, and gateway with the repository's root setup instructions. From this directory:

```powershell
npm ci
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` and `/hubs` to the gateway at `http://localhost:5100`. The root Compose deployment serves the built application at `http://localhost:8088` with the same-origin gateway proxy. Only change the values in `.env.example` when using a different API base or identity provider; browser variables are public and must never contain credentials or client secrets.

The generated root `.env` contains development-only account credentials. Keycloak usernames are `dispatcher`, `technician`, `supervisor`, `analyst`, and `administrator`. The application never embeds their password or provides a role-switch bypass. Use only synthetic customer data in the local demonstration.

## Implemented workspaces

| Workspace          | Working behavior                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Secure sign-in     | Keycloak authorization code flow with PKCE, callback validation, local return-path restoration, session expiration handling, and identity-provider logout.                                                                                                                                                                                                                           |
| Overview           | Authorized live work, current stage, technician, SLA status, persistent deadline, recent requests, and task shortcuts.                                                                                                                                                                                                                                                               |
| Work orders        | Search, status/priority filtering, validated creation, details, optimistic-version updates, and cancellation of eligible unassigned requests.                                                                                                                                                                                                                                        |
| Scheduling         | Appointment inputs in the browser's local time, baseline or OR-Tools recommendations, human-readable explanations, booking confirmation, versioned rescheduling, and cancellation with an audit reason. A reason is required to select a lower-ranked recommendation.                                                                                                                |
| Technician jobs    | Assigned requests and the eight-stage HVAC pipeline. The backend's versioned template supplies field labels, options, required fields, and conditional fields.                                                                                                                                                                                                                       |
| Guided service     | Stage stepper, deadline countdown, backend SLA status, device-local drafts, validated sequential submission, read-only completed answers, assistance requests, and explicit concurrent-state errors.                                                                                                                                                                                 |
| Supervisor         | At-risk work first, notification acknowledgment, reasoned pause/resume/override controls, advisory risk review, and operational replay.                                                                                                                                                                                                                                              |
| Predictive advice  | Real intelligence inference with editable, explicitly identified assumptions for inputs unavailable in the current workflow. Results show probability, factors, timestamp, model version, intervention, and synthetic-training limitations. Accept/dismiss decisions and reasons are sent to the audited workflow endpoint. Editing model inputs clears stale results and decisions. |
| Analytics          | Authorized warehouse summary, date/category/technician filters, volume trend, service mix, stage durations and breaches, utilization, stage aggregate drill-down, freshness, metric definitions, and real CSV/PDF exports.                                                                                                                                                           |
| Operational replay | Work-order search, timeline, event/service/actor/time/correlation/trace filters, event detail, separate occurrence/recording/arrival/processing times, retries attached to logical events, late-arrival markers, ordering uncertainty, missing causation, integrity metadata, factual findings, CSV/PDF exports, and historical playback.                                            |
| Administration     | Identity-management link and a description of the versioned backend workflow configuration. User, credential, and role changes happen in Keycloak's administration console.                                                                                                                                                                                                          |

All navigation is role aware. Backend policies independently enforce technician assignment, supervisor team scope, reporting permissions, and replay access. An authenticated identity receives its own query cache so one user's cached data is not reused for a different user.

## Authentication and data handling

`oidc-client-ts` stores access and refresh tokens in memory. Session storage holds only the short-lived PKCE transaction needed across the authorization redirect. Refreshing the page therefore shows the sign-in entry point again; continuing uses the existing Keycloak session when available. There is no browser-embedded client secret, password grant, persistent bearer-token storage, or frontend authentication bypass.

The OAuth redirect URI is `${origin}/auth/callback`; register the exact permitted origins and logout redirects in Keycloak. The local defaults use `http://localhost:8080/realms/fieldops` and public client `fieldops-web`. External deployments require HTTPS, a reviewed content security policy, exact identity-provider redirects, and their own deployment configuration.

Drafts store only selected form answers under user + workflow + stage keys in local storage. Drafts do not submit automatically, stop the authoritative SLA, or bypass backend state and option validation. Answers and the submission idempotency key remain available after a failed submission; a successful submission clears that stage's draft. Browser refresh or leaving the page can create a new key, so users should reload server state after a concurrency conflict rather than assuming a failed network response proves the server rejected an operation. The mobile application owns the durable offline synchronization queue.

## Replay behavior

The replay console reads a dedicated investigation endpoint. It does not query operational databases directly or execute operational commands. Its pure state reducer applies recorded events through the selected timeline position; filtered visibility never changes the source event array. Playback uses one recorded event per step, with selectable speed, previous/next, first-event, timestamp, SLA-breach, and supervisor-intervention jumps. This is event stepping, not a real-time simulation of the original wall-clock gaps.

The backend projection order is preserved. Causation and source sequence remain distinct from original occurrence time and processing time. Uncertain cross-service order and missing causal evidence are labeled rather than presented as a guaranteed total ordering. One logical business event can have multiple displayed delivery attempts without being shown as multiple business actions. Diagnostic system observations are labeled separately from business events. Retry totals and attempt numbers remain explicitly unknown when the transport has not supplied reliable evidence; consumer and fault identifiers remain visible. Technical JSON appears only when expanded.

Jaeger availability is checked before showing a direct trace link. A missing trace is explained as potentially expired or unsampled; an unreachable trace service offers the Jaeger home page and retains the identifier for manual search. Cross-origin restrictions may prevent browser-side trace availability checks even when the trace exists. Audit correlation metadata remains visible independently of Jaeger's retention period. Incident exports are generated by the authorized backend, not synthesized by the browser.

## Build, tests, and screenshots

```powershell
npm run typecheck
npm run build
npm test
npm run format:check
npm audit
npx playwright install chromium
npm run test:e2e
```

`npm test` runs 17 unit/component checks covering order validation and successful/rejected mutations, conditional form visibility, approved-pause countdowns, access errors, historical state boundaries, replay input immutability, original-time filtering of late arrivals, retry grouping, rendered completion progress, and unknown terminal-fault provenance. The latest local build, 17 tests, and formatting check passed. Full dependency audit returned zero reported vulnerabilities after pinning patched packages. These results do not replace backend, live integration, accessibility, or penetration tests.

The default Playwright command runs desktop and mobile Chromium checks for unauthenticated route protection, keyboard focus, and login layout. It starts Vite automatically when `WEB_BASE_URL` is unset. Live checks are opt-in because they create synthetic work orders and bookings:

```powershell
# With the complete local stack running and a generated root .env:
$env:FIELDOPS_LIVE_E2E = '1'
$env:WEB_BASE_URL = 'http://localhost:8088'
npm run test:e2e -- --workers=1
```

The live suite uses real PKCE login, dispatcher creation and booking, supervisor warehouse analytics, and replay navigation. A further read-only test uses a completed workflow from the root API demonstration to verify disabled historical dropdowns, playback stepping, and real incident downloads without operational mutations. It skips that scenario explicitly when no completed workflow exists. Passwords are read into memory from `DEMO_PASSWORD` or the generated root `.env`; they are never logged or copied into browser storage or test fixtures. The repository-level test report records the final executed live results.

To capture actual application screenshots after running the demonstration:

```powershell
$env:WEB_BASE_URL = 'http://localhost:8088'
npm run screenshots
```

Screenshots are written to `apps/web/artifacts`. The script signs in as the synthetic supervisor, captures the real overview, supervisor and warehouse workspaces, selects the available investigation with the strongest recorded incident history, and captures a guided workflow when available. It reads operational evidence without creating or changing work. Screenshot contents depend on the actual local data and ingestion progress.

## Accessibility and limits

The application uses semantic headings and tables, visible keyboard focus, a skip link, associated form labels, text plus color for severity, accessible notification counts, a native playback range, responsive navigation, reduced-motion handling, and Fluent Dialog focus trapping. Main and secondary operational text use a restrained palette with readable sizes. A complete WCAG 2.2 AA audit and assistive-technology review have not been performed.

Available analytics charts are the ones in the table above; the UI does not yet provide every proposed analytical visualization or every combination of supervisor/stage/SLA filters. Administration links to Keycloak and describes backend configuration; it does not pretend to provide a visual workflow-template editor. Browser drafts are local device storage, not an encrypted cross-device draft service. Model advice uses synthetic training data and requires supervisor judgment; it is not evidence of real-world predictive accuracy. Route splitting keeps analytics and workflow modules separate, although the shared Fluent UI/authentication entry bundle still produces Vite's 500 KB advisory warning. The development build emits harmless third-party pure-annotation warnings; compilation succeeds.

# Feature and demonstration inventory

Snapshot: current source at `a21f558`, 2026-11-05. This inventory accounts for discovered implemented capabilities and explicit gaps. It does not mark a feature “demonstrated” solely because a screenshot exists. Final presentation clips, observed native steps and test counts must be reconciled in PRESENTATION_READINESS.md after recording.

Status: **V** means existing executed evidence supports the stated boundary, **I** means inspected implementation with verification/recording still needed for this snapshot, **P** means partial native or product capability, **F** means planned/unimplemented, **B** means environment blocked. Evidence claim IDs refer to [EVIDENCE_MATRIX](EVIDENCE_MATRIX.md). API details and DTOs are in [API_REFERENCE](API_REFERENCE.md).

Database abbreviations: **WO**=fieldops_work_orders, **T**=fieldops_technicians, **S**=fieldops_scheduling, **WF**=fieldops_workflows, **N**=fieldops_notifications, **R**=fieldops_reporting, **WH**=fieldops_warehouse, **KC**=keycloak. All are separate logical databases on local PostgreSQL. Intelligence retains a model in process and does not own operational tables.

## Coherent recording sequences

| Sequence | Audience and purpose | Actions to show | Evidence boundary |
|---|---|---|---|
| W1 | All six web roles | Real login, Home responsibilities, Workspaces, account/logout | Separate authenticated contexts/accounts; no UI role-switch bypass |
| W2 | Dispatcher | Create synthetic order, search/detail, advice, booking, conflict/reschedule/cancel | Demonstrate accepted and rejected outcomes, not just opening a board |
| W3 | Technician / Supervisor | Start pipeline, conditional form, draft, read-only history, assistance and supervisor control | Record actual form receipt/updated stage/version |
| W4 | Supervisor | Warning/breach, persisted notification/ack, advisory decision, replay/filter/playback/trace/export | Use retained real incident; development seconds explicitly labeled |
| W5 | Analyst / Manager | Filters, known/unknown metrics, trends, drill-down, CSV/PDF | Show warehouse freshness and denominator definitions |
| W6 | Administrator / engineer | Identity boundary, template standards, audit evidence, observability | Application role does not authenticate Keycloak administrator console |
| A1 | Native technician | Startup, browser PKCE, callback, My jobs/details/schedule | Native emulator pixels; credentials excluded from recording |
| A2 | Native technician | Accurate dropdown stage, draft, submit, history, assistance/alerts | State each observed success separately |
| A3 | Native resilience | Offline draft/queue, process restart, reconnect/manual sync, conflict review, session restore | Source tests do not substitute for this recording |
| E1 | Engineering supplement | Broker failure/retry, fault queue, immutable evidence, migration/grants/backfill | Capture terminal/log output without credentials/DSNs; preserve original evidence |

The root presentation workstream owns fresh videos under `docs/presentation/demos/`. This matrix uses sequence IDs until those files actually exist and pass media validation. The existing [UI walkthrough recording](../ui-ux/evidence/walkthrough.webm) is historical media, not a blanket replacement for all sequence requirements.

## Identity, roles and navigation

| ID / feature and business purpose | Roles | Owner / database / API | Actual UI (web / native) | Status, test evidence and demo action | Screenshot / video evidence |
|---|---|---|---|---|---|
| F01 Real login/logout and session boundary | All | KC + gateway; OIDC authorization/token/end-session, GET /api/session | Login + account menu / native login + Account | V web, prior V native entry; C03–C05/C32. W1/A1: complete real callback and logout | [Login](../ui-ux/evidence/after-login.png); fresh W1/A1 clips pending |
| F02 Technician Home prioritizes assigned service | Technician | WO/WF/N; GET /api/work-orders, /api/workflows, /api/notifications | Home, My work / My jobs | I/V historical; C06. W1: current job/stage/deadline and Continue | [Technician Home](../ui-ux/evidence/after-home-technician.png); W1 |
| F03 Dispatch Home prioritizes unassigned orders | Dispatcher | WO/S/T; GET orders/bookings/technicians | Home + Assign / not a technician mobile role | I/V historical; home/role tests. W1/W2: Assign opens selected request | [Dispatcher Home](../ui-ux/evidence/after-home-dispatcher.png); W1/W2 |
| F04 Supervisor Home prioritizes exceptions | Supervisor | WF/N; GET workflows/notifications | Home + SLA monitoring / technician app not a supervisor console | I/V historical; C06/C13–C16. W1/W4: inspect urgent row | [Supervisor Home](../ui-ux/evidence/after-home-supervisor.png); W1/W4 |
| F05 Operations Manager Home shows performance | OperationsManager | WH read through Reporting; GET /api/reports/summary | Home + Operations overview / none | I/V historical; C06/C27. W1/W5: explain known vs unknown capacity | [Manager Home](../ui-ux/evidence/after-home-manager.png); W1/W5 |
| F06 Analyst Home avoids customer operations | Analyst | WH; GET /api/reports/summary | Home + Analytics / none | I/V historical; role tests. W1/W5: masked aggregates and no operational notification feed | [Analyst Home](../ui-ux/evidence/after-home-analyst.png); W1/W5 |
| F07 Administrator Home and access boundaries | Administrator | KC/R/WH; API permissions differ by surface | Home + Administration / none | I/V historical; C06/C35. W1/W6: distinguish app admin from KC admin session | [Administrator Home](../ui-ux/evidence/after-home-administrator.png); W1/W6 |
| F08 Role-aware Workspaces, route guards, team scope | All | Frontend + repeated backend policies; KC claims | Workspaces/sidebar / tabs | V backend, I current UI; C05. W1: blocked deep link and permitted workspace | [Mobile navigation](../ui-ux/evidence/after-mobile-navigation.png); W1 |
| F09 Unauthorized/expired session and isolated caches | All | Gateway/services 401/403; native session generation | Error/sign-in state / auth-aware runtime | V source tests, I new runtime recording; C03/C32. A3: account/session restore/isolation | No screenshot proves expiry alone; A3 required |

## Operational service lifecycle

| ID / feature and business purpose | Roles | Owner / database / API | Actual UI (web / native) | Status, evidence and demo action | Screenshot / video evidence |
|---|---|---|---|---|---|
| F10 Order creation and priority | Dispatch roles | Work Orders / WO; POST /api/work-orders | Create work order / assigned read only | V; C07. W2: create labeled synthetic order and inspect returned record | [Order list](../ui-ux/evidence/after-work-orders.png); W2 |
| F11 Order search, status filters, list pages and detail | Operational roles in scope | WO; GET list/max500 and /{id} | Work orders/search/detail (client list pagination) / My jobs/detail | V historical web; C07. W2/A1: find actual order and show category/status | [Detail](../ui-ux/evidence/after-work-order-detail.png), [page 2](../ui-ux/evidence/after-work-orders-page-2.png); W2/A1 |
| F12 Versioned order edits and cancellation guard | Dispatch roles | WO; PUT /api/work-orders/{id} | Edit order / none | V; rules/live tests. W2: show stale/invalid transition and booking-first cancellation | Behavioral evidence requires mutation/check, not list image; W2 |
| F13 Technician qualifications, hours, availability | Supervisory roles edit, technicians self-read | Technicians / T; GET/PUT /api/technicians/{id} | Dispatch candidate/profile data; no full staff CRUD screen / own assignments | V eligibility; I profile-edit demo. C08. W2/E1: inspect real API and ineligible candidate exclusion | [Schedule](../ui-ux/evidence/after-schedule.png); W2/E1 |
| F14 Approved time-off exception creation | Supervisory roles | T; GET/POST /api/technicians/{id}/time-off | API-backed eligibility; no complete time-off editor / none | I current source; C08/C26. E1: add synthetic exception, verify exclusion and redacted event | No screenshot establishes creation; E1 |
| F15 Baseline candidate ranking | Dispatch roles | Scheduling / S + live WO/T reads; POST /api/scheduling/recommendations | Schedule service / none | V; C10. W2: rank same appointment by qualified free workload | Schedule image; W2 |
| F16 OR-Tools operational recommendation | Dispatch roles | S → private intelligence; same route strategy optimized | Schedule service advice / none | V HTTP contract; C10. W2: show solver status, explanation and null travel | W2 receipt required; no fabricated routing map |
| F17 Booking confirmation and overlap prevention | Dispatch roles | S; POST /api/bookings | Dispatch board/confirm / Schedule read | V PG+live; C09. W2: commit appointment and reject overlapping second booking | Schedule image; W2 |
| F18 Reschedule, cancellation, override reason | Dispatch roles | S; PUT /api/bookings/{id}, POST /cancel | Booking editor / schedule read | V source/historical live paths; C09. W2: change interval with reason, cancel safely | W2 |
| F19 Assignment/eventual order projection | Dispatcher/technician | S event → WO local state | Assigned order/status / My jobs | V live lifecycle; C02/C07. W2/A1: wait for projected technician; explain lag | Order detail / My jobs images; W2/A1 |

## Guided workflow, SLA and supervisor decisions

| ID / feature and business purpose | Roles | Owner / database / API | Actual UI (web / native) | Status, evidence and demo action | Screenshot / video evidence |
|---|---|---|---|---|---|
| F20 Start one authoritative workflow | Assigned technician or authorized supervisor | Workflows / WF; POST /api/workflows | My workflow start / Job detail start | V full web/API, prior native stage entry; C12. W3/A2: start confirmed assigned order | [Guided web](../screenshots/guided-service-workflow.png); A2 required for native |
| F21 Eight stage pages and accurate dropdown answers | Execute policy + object scope | WF; GET workflow/template, POST /submit | Workflow stepper / /job/[id]/stage/[stage] | V source+full API, P native. C12. W3/A2: select visible allowed answers | Guided captures; W3/A2 |
| F22 Conditional fields, hidden-option rejection, reassignment guard | Execute policy | WF + pinned backend template | Dynamic fields / native Picker controls | V tests/API; C12. W3/A2: delayed travel reveals reason, invalid hidden value rejected in supplement | W3/A2; API failure supplement |
| F23 Version-pinned templates and read-only stage history | Operational read/execute write | WF; /templates/{version}, workflow snapshots | Completed history / completed/overridden stages | V; template/history tests. W3: read prior answers without commands | Guided capture; W3 |
| F24 Save draft and restore form selections | Assigned technician/supervisor UI | Browser local storage or native owner AsyncStorage | Save draft / Save draft | V source/component, P native recording. C31. W3/A3: save, leave/reopen, confirm selection | A3 required for native persistence claim |
| F25 Persisted SLA countdown and threshold catch-up | Technician/supervisor | WF; server clock + Quartz; GET workflow | Countdown/status / countdown/status | V backend+resilience; C13. W4: show warning/critical/breach metadata, labeled seconds demo | [SLA screen](../ui-ux/evidence/after-sla-monitoring.png); W4/E1 |
| F26 Assistance path when choices do not fit | Execute policy | WF→N/R; POST /assistance | Request assistance / assistance sheet | V server+SignalR, P native UI. C14/C16. W3/A2: submit truthful assistance reason | W3/A2 |
| F27 Approve pause, resume and preserve breach | Supervise policy | WF; POST /pause, /resume | Supervisor controls / native read reflects pause | V; C13/C14. W4: reasoned pause/resume and unchanged historical breach | W4/E1 |
| F28 Reasoned one-stage override | Supervise policy | WF; POST /override | Supervisor dialog / read-only overridden history | V source/tests; C14. W4: cannot skip final form or act while paused | W4 or API supplement |
| F29 Concurrent submit/idempotent response | Execute policy | WF; POST /submit + receipt | Conflict/refresh feedback / queue conflict | V server+queue tests; C15. W3/A3/E1: retry identical key, reject stale/different body | Needs actual request/result; A3/E1 |
| F30 Prediction inputs and calibrated advisory risk | Supervisor/manager/admin | Private model via gateway; POST /api/intelligence/predict | Advisory SLA assessment / none | V model/API; C29. W4: confirm assumptions, show probability/factors/version/time | W4 |
| F31 Accept/dismiss intervention provenance | Supervise policy | WF; POST /interventions → R/WH | Advice decision dialog / none | V resilience event; C30. W4: record decision/reason, later inspect replay | W4/E1 |

## Alerts, analytics and investigation

| ID / feature and business purpose | Roles | Owner / database / API | Actual UI (web / native) | Status, evidence and demo action | Screenshot / video evidence |
|---|---|---|---|---|---|
| F32 Persisted warnings/escalations and acknowledge | Operational with audience scope | Notifications / N; GET list, POST /acknowledge | Bell/Notifications / Alerts tab | V server/history; P native. C16. W4/A2: exact persisted notice + acknowledgment | SLA/notification capture; W4/A2 |
| F33 Live team/technician SignalR delivery | Operational with signed group | N; /hubs/notifications | Live updates/bell / mobile uses polling | V actual WebSocket; C16. W4/E1: new notice received and same ID in history | Mobile is not native background push; W4/E1 |
| F34 Filtered warehouse summary and unknown semantics | Report policy/team | Reporting / WH read only; GET /reports/summary | Analytics/manager Home / none | V query tests, I latest UI; C27. W5: date/category/technician/priority query and null state | [Analytics](../ui-ux/evidence/after-analytics.png); W5 |
| F35 Volume, categories and stage aggregates | Report policy | WH; summary | Analytics charts/drill-down / none | V historical; C27. W5: compare chart/table with definitions | Analytics image; W5 |
| F36 SLA completion trend, duration histogram, action trend | Report policy | WH; WarehouseAnalytics summary fields | WarehousePatterns tabs / none | I current source/component tests; C27. W5: show known samples and empty state | [Duration tab](../ui-ux/evidence/after-analytics-tab-duration.png); W5 |
| F37 Escalation share and confirmed-booking coverage | Report policy | WH; summary | Analytics KPI area / none | V query tests/I current render; C27. W5: explain unique-order denominators and naming limits | W5 |
| F38 Appointment utilization and historical capacity | Report policy | WH SQL function | Analytics/manager capacity / none | I expanded SCD2/time-off source; C26/C27. W5/E1: explicit date range and null/observed capacity | W5/E1; confirm current migration ledger |
| F39 CSV and PDF operational report exports | Report policy | WH filtered loader; GET /reports/export.csv or .pdf | Analytics buttons / none | V live prior; C27. W5: download/open actual output with same filters | W5; files are evidence only when actually generated |
| F40 Replay search/filter and event details | Replay=Supervisor/Administrator | Reporting / R; GET /replay/{order} | Operational replay / none | V; C19–C22. W4: occurrence/arrival/processing, actor/service/correlation/trace | [Replay](../ui-ux/evidence/after-replay.png); W4 |
| F41 Read-only historical playback | Replay policy | R immutable evidence + derived state | Play/pause/prev/next/speed/jump / none | V browser tests; C21. W4: move cursor, verify no command request | W4 |
| F42 Retries, late arrivals, missing causation and uncertainty | Replay policy | R; separate original/attempt/fault records | Delivery panel/technical disclosure / none | V PG/domain/live incident; C17/C20. W4/E1: inspect one logical event with attempts | W4/E1 |
| F43 Factual incident summary and CSV/PDF | Replay policy | R; /replay/{id}/export.csv or .pdf | Incident findings/export / none | V live exports; C22. W4: compare breach deadline/completion/actions/outcome and explicit no-root-cause inference | W4 |
| F44 Scoped trace availability then retained Jaeger trace | Replay policy; Jaeger separate local surface | R membership + private trace probe; /traces/{id}/availability | Check trace availability / none | V probe/live; C23. W4/E1: retained/expired/unreachable distinctions | Trace video/screenshot required; W4/E1 |
| F45 Administrator replay projection rebuild | Administrator plus replay policy | R; POST /replay/projections/rebuild | API operation; no ordinary playback mutation / none | V source/tests; C19/C20. E1: derived rebuild from originals, compare integrity | E1, preserve originals |

## Mobile resilience and engineering operations

| ID / feature and business purpose | Roles | Owner / database / API | Actual UI (web / native) | Status, evidence and demo action | Screenshot / video evidence |
|---|---|---|---|---|---|
| F46 Native app startup, My jobs/details, today schedule | Technician | Same WO/S/WF APIs | Corresponding web modules / native tabs/job detail | Prior V native login/entry, P complete flow; C33. A1/A2 | [My jobs](../screenshots/mobile/after/my-jobs.png); A1/A2 |
| F47 SecureStore session restore and guarded refresh | Technician | KC + device SecureStore | Browser tokens memory only / native Account/session | V source and prior native restore; C32. A3: force-stop/relaunch and verify owner | [Account](../screenshots/mobile/after/account.png); A3 |
| F48 Offline cache/draft and queued original operation | Technician | Device AsyncStorage; later POST /submit | Web draft only / native Sync and offline banner | V source tests/P native; C31. A3: disconnect, save/queue, restart and inspect | A3 required |
| F49 Backoff, reconnect/manual retry, conflict review | Technician | Device serialized queue + server version/receipt | Web conflict error / native Sync actions | V source tests/P native; C15/C31. A3: retry pending same identity; retain failed/conflict block | A3 required |
| F50 Owner isolation and explicit online/offline status | Technician | Device namespaces + API owner checks | Web session cache isolation / native banner/account namespace | V source tests/P native; C05/C31/C32. A3: no cross-account cached job bleed | A3 |
| F51 Redacted incremental warehouse ingestion/quality | Operator/analyst | Analytics / WH; broker worker, no public command API | Freshness/metric definitions / none | V prior + I expanded tests; C24–C28. E1: ledger/quality checks without operational writes | E1 |
| F52 Archive backfill/reconcile | Operator | WH; CLI backfill.py | CLI / none | V PG tests; C28. E1: dry-run counts, apply missing IDs, repeat no-op | E1 |
| F53 Restart/retry/poison message/broker recovery | Operator | WO/WF/N/R/S; scripts | Recorded operational effects / none | V live root artifacts; C17/C18. E1: controlled local flags, restore normal settings | E1 |
| F54 Metrics, traces, logs, readiness | Engineer/admin | Six services + monitoring | Grafana/Prometheus/Jaeger separate tools / none | V local observability; C23/C35. E1: six scrape targets, retained trace, liveness vs readiness | New architecture/observability clip required |
| F55 Migration/runtime least privilege and fresh boot | Operator | All DBs; migration jobs and grants | CLI / none | V root fresh-volume/grants checks; C01/C19/C35. E1: show job exits/readiness, no DSN output | E1 |
| F56 CI builds/tests/security/containers | Engineer | GitHub Actions definition, Dockerfiles | Repository/workflow / none | V local paths, P remote; C35. E1: read actual jobs and local evidence | Never show unrun green remote pipeline |
| F57 Identity administration and template standards | Administrator | KC + immutable WF config | Administration links/describes boundary / none | P in-app administration; C12/C35. W6: open known local KC destination without exposing admin secret | [Administration](../ui-ux/evidence/after-administration.png); W6 |

## Explicitly incomplete or future capabilities

| Capability | Status | Honest presentation/demo treatment |
|---|---|---|
| General Digital Operations Simulator (absence/surge/what-if UI) | F | Existing deterministic tests/resilience flags are narrower; roadmap slide only |
| Real geocoded routing/traffic, multi-day route optimization | F | Operational travel null; synthetic depot proxy evaluation explicitly labeled |
| Runtime workflow template publishing UI | F | Versioned embedded v1 is real; authoring/publishing UI is absent |
| Full staff/time-off management screens | P | API/validation is real; do not stage a nonexistent editor |
| Supervisor/stage/SLA analytics filter parameters | P | Current signature supports date/technician/category/priority only |
| Native background push | F | Alerts poll while foreground; backend deadlines continue while closed |
| Every intermediate attempt across every consumer / automatic poison repair | P | Reporting attempts and generic terminal faults exist; unknown totals remain unknown |
| Encrypted mobile draft database / managed wipe | F | Tokens use SecureStore; AsyncStorage cache/drafts do not inherit that encryption guarantee |
| iOS native execution/store release/physical device certification | B | Requires macOS/device/release process; source compatibility is not execution proof |
| Production cloud/TLS/MFA/rotation/retention/restore certification | P/F | Local deployment and isolated fresh startup are verified; external deployment not authorized or claimed |
| Full WCAG 2.2 AA/assistive-technology certification and load benchmarks | P | Show scoped real checks; full assessment and realistic load remain release work |

## Coverage closure

For each final clip, record sequence ID, exact file, capture time, codec/duration, roles/actions observed and any skipped step in the readiness inventory. Add new clips only after actual recording and playback validation. A successful W2 creation does not prove rescheduling or duplicate prevention unless that action/result is visible or separately linked to executed tests. Keep test evidence and live-demo evidence separate throughout the talk.


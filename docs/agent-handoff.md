# Enterprise implementation handoff

Updated: 18 November 2026, America/New_York. The active request is the nine enterprise capabilities in the latest attached brief. All nine remain in scope. Implement one coherent vertical slice at a time and continue independent work when an external gate is unavailable.

## User decisions and workspace

- User chose **local/test foundations** for notifications, Microsoft adapters and external validation. Do not invent credentials or claim live external delivery, tenant integration, staging, legal approval or certification.
- Repository: `C:/Users/tousi/Downloads/fieldops3600`, branch `codex/enterprise-completion`. Current saved commits include `d58be3e`, `935d82b`, `a9aaddd` and `d7ad124`. Follow actual Git state; do not redo committed work or commit/push automatically.
- Preserve unrelated untracked `TRADING ENINGE/` and `data/server.pid`. Do not inspect, modify, stage or delete them as part of FieldOps work.
- The original landing implementation remains in `stash@{0}`. Do not apply it over the newer website. The public landing page was already deployed at `https://tousif-anwar.github.io/fieldops3600/` from `1ea2dffb0bc476326faadb9db3832b1f6733ec0e`; authenticated backend changes are not a new Pages deployment.

## Current phase and capability status

| Capability | Current evidence and remaining work |
|---|---|
| Inventory | Backend, web and technician-mobile source implemented; HTTP workflow, desktop/Pixel7 browser journey and real local RabbitMQ reporting delivery passed. Native Android/iOS runtime acceptance remains. |
| Maintenance contracts | Agreements, coverage/exclusions, equipment dates, recurrence, renewal, optional lifecycle sweeps, durable dispatch, completion-driven usage and portal read implemented. Latest allowance allocation and recurrence amendments now pass full backend regression; updated runtime/browser acceptance is in progress. SLA entitlement and terms/exclusion amendment UI/API remain gaps; financial/material allowance integration belongs with later commercial work. |
| Customer options/self-booking | Not implemented. Next phase reuses scheduling and its Booking authority; see booking design document when completed. |
| Estimates/signatures/authorization | Not implemented. Shared decimal/currency calculation foundation exists; immutable approved revisions and a real authorization guard remain. |
| Costing/invoices | Not implemented. Use actual stock/labor facts and one coherent commercial context; no invented costs or tax/legal claims. |
| Notifications/preferences | Not implemented beyond existing in-app history. Add durable local provider sink, preferences, retries and truthful delivery states. |
| Secure media/retention | Not implemented. Private verified uploads, authorization, retry/retention and mobile queue remain. |
| Dataverse/Power Automate | Not implemented. Optional adapter with authenticated, versioned contracts; mocks differ from live tenant evidence. |
| Production readiness | Not implemented. Hardened deployment, secrets/TLS/backups/restore, release gates and factual control evidence remain. |

Do not promote a capability merely because its screen exists. Relevant domain/API/database/authorization/events/client/failure/CI/end-to-end gates must pass.

## Architecture and business rules

- Preserve canonical work-order lifecycle, scheduling, assignment offers, technician execution, customer intake, reporting/replay and existing owner boundaries.
- Inventory is its own stock/ledger context (service5109). Contracts extend `customers`; equipment remains owned by `assets` and is validated through its reference API. Do not add a separate service for each new capability.
- Reuse numbered immutable SQL migrations/checksums, actor-scoped request hashes/receipts, shared PostgreSQL advisory locks, transactional outbox and inbox deduplication. Runtime roles do not own schema.
- Maintenance dispatch commits intent under the customer team lock, calls the canonical work-order owner outside that transaction, then links the result. Deterministic work-order ID equals visit ID. Lost responses repair the same commitment, including after trusted completion; retries do not create another job or repeat usage. Scheduling assigns technicians separately.
- Customer consumer accepts matching owner work-order and scheduling facts, respects assignment revisions and terminal service state, and appends exactly one completed visit usage with zero invented material cost. Changed/ineligible coverage retains Completed evidence with an explicit review reason. Current non-active terms and intervening lifecycle changes conservatively require review.
- Finite maintenance visit allowance now accounts for consumed usage plus Dispatching/Created/Scheduled allocations and unresolved completed review allocations. Own-visit validation is bound to exact committed references. Only a canonical `WorkOrderUpdated.v1` Cancelled fact releases capacity; appointment cancellation and pending cancellation intent do not. Ordinary job coverage snapshots remain advisory; no general financial authorization is claimed.
- Recurrence amendment uses expected contract/plan versions, a reason, an active owned site, receipt, audit and outbox. Its new first date must follow all already-generated dates for the same line/equipment. Existing visits/jobs retain dates. No deletion or hidden rescheduling.
- Renewal creates a new future Draft with fresh terms/IDs/allowances and immutable linkage. Usage, visits and plans are not copied. Future Draft plans can be configured; activation cannot precede the exact effective instant.
- Month-end anchors and agreement-local time zones are enforced. Lifecycle worker is integrated but default-disabled unless an explicit horizon/policy is configured. Per-agreement failures roll back and do not starve healthy agreements.
- Reuse Fluent UI and native mobile patterns. Stock writes are online-only. Keep production or legal claims tied to independent evidence.

## Migrations and local runtime

Applied to the existing local databases without resetting volumes:

- customers001 existing registry,002 contracts,003 maintenance site/dispatch,004 renewal/calendar lifecycle,005 completion/review/revision evidence.
- work-orders009 maintenance/coverage snapshot fields.
- Earlier inventory migrations/context are already deployed. Never edit applied migration files.
- Allowance allocation and plan amendment add no schema migration.

Docker Desktop was stopped on18November and has been started hidden. Docker29.9.2 is ready. At this handoff update, `docker compose build customers work-orders web` followed by `docker compose up -d` is still running in root exec session88537. Logs: `.local/contract-allowance-build.log` and `.local/contract-stack-start.log`. Image layers are downloading; do not reset volumes or start competing rebuilds. Wait for completion, run readiness, then authorize live checks.

## Verification

Latest source:

- Full backend **231/231 passed, zero skips**, clean compile,1m7s on18November. Command: `.\.tools\dotnet\dotnet.exe test tests/backend/FieldOps.Tests.csproj -c Release --no-restore -m:1 --disable-build-servers -p:UseSharedCompilation=false`.
- The grown suite initially failed from synthetic site insert ordering and pooled connections retained for many disposable test databases. Test-only fixes persist customer/sites before bound plans/visits and set `Pooling=false` only for isolated test database connection strings. Production pooling/constraints are unchanged. See `ContractPlanApiTests.cs` and `PostgresIntegrationTests.cs`.
- Allowance/consumer/dispatch focused selection previously **27/27** passed. Recurrence amendment tests are now included in the231 full result.
- Current web typecheck/lint passed; full test/build command is running in root exec session3557. The new recurrence editor has two component tests; final result is pending.

Earlier verified runtime (before latest allowance/amendment deployment):

- Backend completion/dispatch batch **195/195**; web **80/80**, formatting/typecheck/lint/build passed; mobile **48/48**, Expo dependencies aligned.
- `python tests/backend/verify_contracts_http.py -v` **1/1 passed in110.3s** through real Keycloak, gateway, scheduling, technician template execution, RabbitMQ, work-order completion and exactly one zero-material-cost contract usage record. Script now also asserts committed/available allowance; rerun against updated images.
- `python scripts/verify-database-permissions.py` passed isolated runtime identities and append-only history/renewal ACLs.
- `python scripts/verify-enterprise-delivery.py` passed recent inventory **20published/20audit/20inbox** and customers **20/20/20**, including completion/usage events after the real workflow. Read-only matching; no injected messages. Must run after fresh workflows because it requires events within24hours.
- Inventory live browser **2/2** and contract generic/restricted equipment journeys **4/4** passed on desktop/Pixel7. Real assets/site/version are preserved through plan, work order and renewal. Intrinsic mobile form overflow and newly-created detail cache races were fixed and verified.
- Latest combined60-case browser attempt had **43passed/14intentional mobile skips/3failures** from real gateway429s. A fresh-window four-worker attempt also exceeded the shared manager's240/minute budget by the phone phase. Do not weaken the limiter or claim a green full suite. A bounded desktop-then-phone runner with fresh windows and preserved output directories is being added; old ephemeral session72078 is unavailable and its success was not established.

## Current parallel work

- `contract_regression_repair`: backend fixes/result complete; preparing read-only `docs/enterprise/CUSTOMER_BOOKING_DESIGN.md` for the next phase. No runtime/manager traffic.
- `contract_acceptance_review`: extending four real contract journeys to amend recurrence before renewal; adding a bounded live E2E runner/package/CI hook. Wait for root runtime-ready signal. Trace remains off for sensitive browser specs. Preserve every assertion and propagate failures.
- Inherited fixture cleanup requires read/confirm before writes: exact contract suffix `8d95c1b1` with matching synthetic site, and Inventory job `Synthetic inventory browser job937aa790` /number `WO-20261116-648B99` (check actual spacing in stored record). Only cancel own unassigned Created records after checking no booking/workflow activity; release only their reservations/requests. Never delete customer/site/ledger/history. An interrupted cleanup may have performed a prefix; re-read state first.

## Next action

1. Finish current web checks and local image/start/readiness. Preserve unrelated files and existing data.
2. Run updated real contract HTTP, ACL and broker evidence against the allowance/amendment runtime. Then allow a fresh rate-limit window before the four extended contract browser journeys and bounded full browser suite. Do not restart services while acceptance runs.
3. Fix concrete failures without skipping or weakening checks. Update evidence/handoff and clearly distinguish source, PostgreSQL, real local broker/browser, native and external gates.
4. Address remaining contract SLA/terms-management gaps as explicit slices or document their later dependency; begin customer self-booking through the existing scheduling authority once this acceptance batch is settled. All subsequent capabilities remain authorized and unfinished.

Relevant skills previously read/applied: React best practices, React Native patterns, .NET security, code simplification, behavior-oriented API testing, and the official ASP.NET Core skill pinned into `.local/enterprise-skills/aspnet-core`. No external credentials or production approvals have been inferred.

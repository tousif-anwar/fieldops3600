# Enterprise implementation handoff

Updated: 15 November 2026, America/New_York. Active request: nine enterprise capabilities in the latest attached brief, implemented as dependency-aware vertical slices. All nine remain in scope.

## Current phase

Foundation baseline verified; inventory is the first implementation slice. Work is on `codex/enterprise-completion`, based on `1ea2dffb0bc476326faadb9db3832b1f6733ec0e` (current main after the public website release). The original working tree was on an older security branch. Its untracked landing implementation was preserved in `stash@{0}` with message `Preserve original landing implementation before enterprise feature work`; do not apply that stash over newer website sources blindly.

The user chose **local/test foundations** for external services. Use synthetic local notification sinks and contract-tested Microsoft adapters. Real delivery, an authorized Dataverse tenant, staging hosting, legal assessment, and production certification are not available evidence. Continue independent work rather than inventing credentials or claiming these gates passed.

## Capability status

| Capability | Status | Next gate |
|---|---|---|
| Inventory/reservations/transfers/consumption | Implementation in progress | Atomic stock rules, migration, authorized API, web/mobile forms, race/failure tests, actual workflow |
| Maintenance contracts/entitlements/recurrence | Not implemented | Begin after inventory baseline is integrated |
| Customer appointment options/self-booking | Not implemented | Extend authoritative scheduling and constraints, no duplicate booking state |
| Estimates/e-signature/financial authorization | Not implemented | Decimal policy, immutable approved revision/hash/intent evidence, work authorization guard |
| Billing/job costing/internal invoices | Not implemented | Consume actual stock/labor and contract/estimate facts; immutable issued snapshot |
| External notifications/preferences | Not implemented | Extend notifications; durable local delivery sink and preferences/retry states |
| Secure media/retention | Not implemented | Authorized private objects, verified content, upload/retention state, offline retry |
| Dataverse/Power Automate adapter | Not implemented | Optional authenticated adapter; mocks/contract tests distinguished from live tenant |
| Production deployment/certification evidence | Not implemented | Hardened environment/secrets/TLS/backups, restore/smoke evidence, external controls matrix |

Do not promote a row to complete until its applicable definition-of-done gates in the user brief pass. Source code or a successful screen render alone is insufficient.

## Architecture decisions

- Keep the eight existing service-owned contexts and canonical work-order lifecycle. Preserve customer intake, assignment offers, service reports, SLA, and replay.
- Add inventory as one justified bounded context: stock balances, reservations, transfer receipts, consumption, and an immutable ledger must commit atomically. Do not create a service for every requested capability.
- Reuse PostgreSQL migrations/checksums, per-service EF models, actor-scoped request hashes/receipts, transactional outbox, inbox deduplication, signed role/team claims, and authoritative remote resource checks.
- Reuse the existing Fluent UI and React Native design tokens/components. Inventory mutations initially require a connection; never silently queue optimistic stock balances.
- Proposed later commercial context groups contracts, estimates, and invoices with explicit modules rather than three independent financial ledgers. Validate this decision before implementation.
- New production or legal compliance claims require independent evidence. Deterministic monetary rules are application policy, not tax/legal advice.

## Active ownership

- Root: integration, shared conventions, persistent handoff, next phases.
- `inventory_backend`: inventory domain, persistence mapping, API/service/migration, business tests. Shared host registration stays with root.
- `inventory_clients`: API-backed web/mobile inventory screens and component/client tests, minimal route/navigation integration.
- `enterprise_foundation`: architecture audit, baseline commands/results, infrastructure findings in `docs/enterprise/`.

All agents share the same working directory. No agent should stage, commit, push, alter old migrations, reset a database, or deploy production as part of this implementation run.

## Verification so far

- Read the current enterprise brief and inspected actual current-main architecture.
- No repository AGENTS.md files found at task start.
- Pinned SDK `.tools/dotnet/dotnet.exe` reports .NET 10.0.403. The system SDK is a different preview; use the pinned executable.
- Baseline backend build: passed, zero warnings/errors (foundation agent, 29.37 seconds).
- Initial baseline test selection exposed a stopped Docker engine. After starting installed Docker Desktop hidden, the full pre-change compiled backend suite passed **118/118, zero skips**, including actual PostgreSQL Testcontainers (11 seconds). No volumes were reset. Use the default Docker context; do not set a custom DOCKER_HOST. Exact commands/results are in `docs/enterprise/BASELINE.md`.
- Web/mobile baseline checks are in progress with client agent. Mobile dependencies initially lacked ESLint; install from the current lockfile without scripts before judging source correctness.
- No enterprise migration has been applied or capability certified complete yet.

## Current implementation batch

- Inventory agent has created `Core/Inventory.cs`, `ServiceHost/InventoryPersistence.cs`, `services/inventory` and immutable-ledger migration `001_initial.sql`; API and tests are in progress. The API file may not exist until the batch is saved, so host registration temporarily references a pending module; do not misclassify that as the pre-change build baseline.
- Root made ServiceDb partial and registered its Configure/Ignore mapping, inventory authorization policies, endpoint map, embedded SQL, solution project, gateway prefix, Compose runtime/migration job, Prometheus target, database bootstrap/reconciliation, and explicit ledger ACLs. Inventory runtime owns no schema objects; movement access is SELECT/INSERT only.
- `scripts/test-local-bootstrap.py`: **6/6 pass** after adding a non-destructive pre-inventory upgrade regression. The upgrade test preserves the exact prior environment prefix, existing passwords, and realm bytes while adding inventory credentials.
- Root added `Core/MonetaryPolicy.cs` and `tests/backend/MonetaryPolicyTests.cs` for deterministic decimal rounding, configured currency precision, discounts/taxes, and minute-based internal labor cost. Tests have not yet run; this foundation is not an estimate/invoice implementation.
- Foundation agent now owns safe non-order event reporting projection, gateway readiness and its tests, and relevant inventory CI hooks. Other shared host/Compose/schema integration stays with root.

## Skills and provenance

Read applicable installed React, React Native, .NET security, and code-simplifier instructions. The installed API-testing reference is MCP-specific; retain its behavior/isolation principles without adding MCP framework abstractions to this application.

The additional official OpenAI ASP.NET Core skill was inspected at commit `49f948faa9258a0c61caceaf225e179651397431`: instructions, ownership, file inventory, and permissions. It contains Markdown references/assets and no executable install scripts. The trusted local skill-installer acquired it into ignored `.local/enterprise-skills/aspnet-core`. Read stack selection, host/pipeline, Minimal APIs, data/state, security, and testing/operations references. Apply the repository's .NET 10 Minimal API/EF/PostgreSQL patterns; no framework rewrite.

## Next action

Finish the baseline and integrate inventory registration, service routing, least-privilege database roles, non-destructive upgrade, and Compose/CI. Verify the real inventory slice before advancing to contracts. Update this handoff after every significant batch with exact changed files, migration names, tests, limitations, and next action.

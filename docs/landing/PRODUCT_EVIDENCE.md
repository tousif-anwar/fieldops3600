# Historical product and visual evidence snapshot

Initial review: 2026-11-14 against historical commit `922335b35a609dce64fa2476403dcfca86ac51ba` on `copilot/fix-security-actions-job`. The claim gates and source links below preserve that historical review and screenshot provenance; they are not an inventory of the newer deployed `main` implementation. All historical source links are pinned to that exact commit.

Publication integration uses the newer `main` source and its current documentation. The [business operations audit](../BUSINESS_OPERATIONS.md) supersedes older statements that assignment offers, customer accounts, or independent customer/equipment records do not exist. The [current operational verification](../OPERATIONS_VERIFICATION.md) records the later Android offline and guided-service runtime results. The landing page intentionally presents only common implemented capabilities and labels older development screenshots, rather than advertising every newer feature.

## Positioning and audience

The primary audience is dispatchers and service supervisors assessing an HVAC-oriented operations workflow. The secondary audience is engineering reviewers inspecting service boundaries, consistency, authorization, and evidence. The conversion goal is to explore real capabilities, then read the walkthrough or source. No public authenticated demo, commercial trial, sales service, customer deployment, or certification is established.

Recommended hero: **Field service operations, from dispatch to completion.**

Recommended supporting copy: **Coordinate qualified technicians, guide HVAC service work, monitor deadlines, and keep a clear record of each job.**

The first CTA should scroll to the actual product/capabilities section; the secondary CTA should open the repository. Label the implementation as an engineering demonstration using synthetic data. Business value comes before the architecture.

## Claim gates

| Historically reviewed claim / recommended copy | Evidence at the pinned historical commit | Historical boundary |
|---|---|---|
| Qualified dispatch: match appointments to skills, certifications, working hours and availability. | [SchedulingRecommendations.cs](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/building-blocks/FieldOps.ServiceHost/SchedulingRecommendations.cs), [BookingRules in WorkflowEngine.cs](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/building-blocks/FieldOps.Core/WorkflowEngine.cs), [booking constraints](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/services/scheduling/migrations/002_booking_constraints.sql) | Confirmation rechecks constraints. Advice does not reserve capacity. |
| Review baseline or OR-Tools recommendations before confirming a booking. | [SchedulingRecommendations.cs](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/building-blocks/FieldOps.ServiceHost/SchedulingRecommendations.cs), [operational optimizer limits](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/services/OPERATIONS_DEMONSTRATION.md) | One fixed appointment, not multi-day routing. No real route/depot coordinates: estimated travel is unknown, not an invented saving. |
| Guided HVAC execution: eight ordered stages with required answers, drafts and an assistance path. | [Workflow design](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docs/workflows/design.md), [web walkthrough](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docs/UI_WALKTHROUGH.md), [mobile guide](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/apps/technician-mobile/README.md) | An immutable HVAC template ships; runtime template authoring is absent. |
| SLA supervision: identify stages approaching deadlines and record reasoned interventions. | [Workflow design](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docs/workflows/design.md), [supervisor walkthrough](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docs/UI_WALKTHROUGH.md) | Server timestamps are authoritative. A device countdown is an estimate; drafts/offline state do not pause deadlines. |
| Operational visibility: review work status, warehouse metrics and service activity. | [Metric definitions](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/services/ANALYTICS_METRICS.md), [Analytics.tsx](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/apps/web/src/pages/Analytics.tsx) | Freshness and null/unknown cohorts matter. No invented performance targets or ROI. |
| Job context: keep customer, location, category and job answers together. | [WorkOrder type](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/apps/web/src/types.ts), [work-order screen](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/apps/web/src/pages/WorkOrders.tsx) | This branch stores customer references/name/address, not an independent customer/equipment registry or equipment service-history product. |
| Audit and replay: investigate recorded events, delivery observations and intervention reasons. | [Replay guide](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/replay/event-store/README.md), [append-only migration](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/services/reporting/migrations/002_append_only_evidence.sql), [walkthrough](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docs/UI_WALKTHROUGH.md) | Read-only reconstruction, not command re-execution. Trace retention and delivery-attempt totals can be unknown. |
| Technician mobile: review assigned jobs, follow stage forms, save local drafts and review synchronization. | [Mobile guide](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/apps/technician-mobile/README.md), [native verification snapshot](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docs/testing/VERIFICATION.md) | No assignment-offer accept/decline lifecycle in this branch. Native Android OAuth/guided entry were verified on 2026-11-05; native stage submission/offline recovery and physical devices remain unverified in this branch's acceptance record. |
| Server-enforced access and business rules. | [Architecture overview](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docs/architecture/overview.md), [threat model](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docs/security/threat-model.md) | Role/team/assigned-technician restrictions; not a security certification or production guarantee. |
| Reliable event processing through outbox and deduplication. | [Architecture patterns](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docs/architecture/patterns.md), [service ownership](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docs/adr/001-service-ownership.md) | At-least-once delivery; do not claim exactly-once transport. |

At the initial review, the landing copy omitted assignment offers, equipment registries, and full customer-record management because the reviewed historical branch lacked them. This is a historical copy decision, not a statement about current `main`; consult the current business operations audit linked above for the expanded implementation. Deterministic scheduling must not be described as AI-powered. The historical advisory prediction model used synthetic training and did not establish real-world accuracy.

## Operational lifecycle

Recommended public sequence:

1. **Request** — record service demand and customer/location context.
2. **Qualify** — check technician skills, certifications and availability.
3. **Schedule & assign** — review advice and confirm a conflict-protected booking.
4. **Execute** — the assigned technician follows the guided stages.
5. **Supervise** — review deadline risk, alerts and reasoned interventions.
6. **Complete & review** — retain completed answers and investigate recorded events.

Supervision happens alongside execution, rather than only after it. The reviewed historical workflow included customer confirmation. The initial branch lacked the later scoped customer portal; current portal scope is described in the business operations audit linked above.

## Architecture and versions

At the reviewed historical commit, six ASP.NET Core service roles owned independent operational PostgreSQL databases: work orders, technicians, scheduling, workflows, notifications, reporting. YARP exposes authenticated API ingress. Keycloak handles OIDC/PKCE. Scheduling calls the private FastAPI/OR-Tools service for advice. Transactional outboxes feed RabbitMQ; consumers deduplicate events. A separate Python ingestion worker writes a warehouse; Reporting reads it using a read-only identity. The warehouse is not an operational shared database.

Keep the public diagram's arrows faithful to these paths: clients → gateway → services; services → their owned databases; outboxes → RabbitMQ → notification/reporting/warehouse consumers; warehouse → reporting reads; scheduling → optimizer. Identity and observability are side systems, not stages through which every business request flows.

| Technology | Evidence at the pinned historical commit |
|---|---|
| .NET 10 / ASP.NET Core | [global.json](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/global.json) pins SDK 10.0.403; [shared service project](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/building-blocks/FieldOps.ServiceHost/FieldOps.ServiceHost.csproj) targets `net10.0` |
| React 19 / TypeScript / Vite | [Web package manifest](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/apps/web/package.json): React 19.3.1, TypeScript 5.9.3, Vite 7.3.7 |
| React Native / Expo | [Mobile package manifest](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/apps/technician-mobile/package.json): React Native 0.88.1, Expo ~58.0.25 |
| PostgreSQL / RabbitMQ / Keycloak / Docker Compose | [Compose configuration](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docker-compose.yml); [architecture overview](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docs/architecture/overview.md) |
| Python / FastAPI / OR-Tools | [Intelligence requirements](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/intelligence/requirements.txt): FastAPI 0.143.3, OR-Tools 9.15.6755 |
| Prometheus / Grafana / Jaeger | [Compose configuration](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docker-compose.yml); [local operations runbook](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docs/operations/LOCAL_DEPLOYMENT.md) |

These are historical repository versions, not the current deployed dependency inventory or a claim that each is the latest upstream release. Do not reproduce old test totals as live badges. Link the dated [verification record](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docs/testing/VERIFICATION.md) instead.

## Genuine visual assets

All published operational records are synthetic. The [walkthrough](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docs/UI_WALKTHROUGH.md) identifies `docs/ui-ux/evidence` as genuine local captures. Image dimensions and visual quality were inspected during this review.

| Source | Dimensions | Recommended use / observation |
|---|---|---|
| [Dispatcher Home](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docs/ui-ux/evidence/after-home-dispatcher.png) | 1440 × 1000 | Strong hero or first product overview; readable queue, technician coverage and appointments. Full-size link useful. Current numeric values are captured synthetic state, not business proof. |
| [Dispatch board](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docs/ui-ux/evidence/after-schedule.png) | 1440 × 1000 | Good scheduling showcase. Form and confirmed appointments visible. |
| [Work-order detail](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docs/ui-ux/evidence/after-work-order-detail.png) | 1440 × 1000 | Supports job context and execution handoff. |
| [SLA monitoring](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docs/ui-ux/evidence/after-sla-monitoring.png) | 1440 × 1356 | Supervision example; preserve the captured overdue state rather than cosmetically changing it. |
| [Analytics](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docs/ui-ux/evidence/after-analytics.png) | 1440 × 2845 | Long page: show a deliberate crop or first screen with full-size access, not an unreadable miniature. |
| [Replay](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docs/ui-ux/evidence/after-replay.png) | 1440 × 1000 | Investigation showcase; link to replay guide for semantics. |
| [Existing native jobs](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docs/screenshots/mobile/after/my-jobs.png) | 1080 × 2400 | Genuine committed capture, but scrolled mid-list with partial top content and visible development overlay; weak hero choice. |
| [Existing native account](https://github.com/tousif-anwar/fieldops3600/blob/922335b35a609dce64fa2476403dcfca86ac51ba/docs/screenshots/mobile/after/account.png) | 1080 × 2400 | Genuine committed capture of storage/sync explanation; development overlay visible. Better as supporting evidence than primary task showcase. |

An ignored local capture `.local/native-guided-stage.png` (1080 × 2400), captured 2026-11-04, shows stage 1/8 of `WO-20261105-FB162B`, matching the Android guided-entry record in the verification document. This earlier blue development interface predates the current green mobile UI; the landing page explicitly labels it an earlier development capture dated 4 Nov 2026. The development overlay remains intact. Newer `.local/frontend-*` assets can show functionality from a different feature branch and should not be reused blindly.

### Selected mobile derivatives

The maintained assets `website/assets/mobile-home.webp` / `mobile-home-full.webp` derive solely from the committed `docs/screenshots/mobile/after/my-jobs.png`. Pillow resized to 540 × 1200 and 1080 × 2400 using Lanczos and WebP quality 85. The selected `mobile-workflow.webp` / `mobile-workflow-full.webp` derive from `.local/native-guided-stage.png` at those same dimensions with WebP quality 88. No content was added, removed, retouched or replaced; the development overlay is retained. The choices deliberately avoid later assignment-offer assets from another branch. Captions identify Android development-build captures with synthetic records, not device certification. The workflow caption also identifies the earlier capture date. A local read-only ADB capture was attempted but no emulator process/device was available, so this pass does not claim a fresh native capture. Unused account derivatives were removed from `website/assets`; the committed account original remains unchanged.

### Desktop derivatives

The landing page's `dispatch.webp` (1440 × 1000) and `dispatch-960.webp` (960 × 667) derive from `docs/ui-ux/evidence/after-home-dispatcher.png`; `schedule.webp` derives from `after-schedule.png`. These are WebP quality 88 derivatives with the original synthetic state preserved. Additional replay/analytics derivatives, if selected, must retain source and crop provenance; a crop changes framing, not operational facts.

Do not edit screenshots to manufacture successful states, remove real warnings or imply physical-device certification. Compression/resizing can create responsive derivatives while the original remains the full-size source.

## Current documentation destinations

The deployed site uses the newer `main` documentation paths. These destinations supersede the historical review paths linked earlier.

| Public link label | Current maintained source |
|---|---|
| Getting started / Installation | [Installation and setup](../INSTALLATION_AND_SETUP.md) |
| Product walkthrough / Features | [User guide](../USER_GUIDE.md), [business operations and limits](../BUSINESS_OPERATIONS.md) |
| Architecture | [System architecture](../SYSTEM_ARCHITECTURE.md) |
| API reference | [API reference](../API_REFERENCE.md) |
| Testing | [Operational verification](../OPERATIONS_VERIFICATION.md) |
| Security | [Security](../SECURITY.md) |
| Documentation | [Documentation index](../README.md) |
| Source | [GitHub repository](https://github.com/tousif-anwar/fieldops3600) |

The generated site and its browser checks validate these public routes under `/fieldops3600/`. The historical source links above remain pinned to preserve their original evidence context.

## Applied review skills and remaining limits

Applied installed `offer-positioning` to map audience pains to proved outcomes and separate differentiators from unsupported claims. Applied `anti-slop-content-review` as a read-only copy/proof critique: removed speculative offers, performance promises, repetitive enterprise adjectives and invented customer evidence from the recommended messaging. Source inspection is the proof basis; no analytics-backed conversion claim or user research was invented.

This review did not rerun service tests, native acceptance, public deployment or a WCAG audit. Those gates belong to implementation QA. The checked-in implementation status and verification records differ in historical test totals; the landing page should not turn either into an undated success metric.

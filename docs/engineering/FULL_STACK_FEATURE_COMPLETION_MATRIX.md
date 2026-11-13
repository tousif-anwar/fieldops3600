# Full-stack feature completion matrix

Current live catalog captured **2026-11-05 16:34:37 UTC**, source HEAD `a37f52c` with the expansion in the working tree: nine FieldOps databases, 71 physical tables, 35 local physical FKs, six views and 28 migration entries. Customer and Asset migrations are applied; both slices remain **PARTIAL** because passing narrow workflows and deployed objects do not establish every required client, role, recovery and expansion gate. This matrix covers individual mandatory capabilities and does not claim the whole requested platform is complete.

## Status and acceptance rules

- **D** = deployed schema object observed in the read-only live catalog. This proves schema presence, not feature correctness.
- **S** = implemented in inspected source; current expanded-slice execution is not established by this status.
- **P** = partial layer or narrower capability; see the evidence/gap column.
- **H** = historical executed local evidence for the pre-expansion capability, retained in ignored local logs/verification records. It must be rerun after relevant changes.
- **M** = required layer missing or not yet evidenced for this slice.
- **N/A-O** = office investigation/finance/reporting/administration only; no technician screen is needed. Field technicians still need relevant operational read context, tracked separately.
- **N/A-A** = internal computed, ingestion or operator-CLI capability with no persisted aggregate or separate end-user route/screen needed; the specific reason is in the row.
- **N/A-I** = identity-provider-owned schema or security infrastructure; Keycloak owns user/role storage and authentication is consumed by both clients.

**PARTIAL** means at least one implemented layer or narrower capability exists but the complete current acceptance record is absent. **MISSING** means no complete required implementation was found. No row is promoted to COMPLETE solely because its cells show source or historical evidence. Promotion requires current migration/upgrade evidence, business/authorization/audit checks, all applicable clients/events/analytics, passing automated tests, real E2E and aligned docs.

## Evidence key

| Key | Inspected source / evidence |
|---|---|
| A | [WorkOrder model/rules](../../building-blocks/FieldOps.Core/Models.cs), [API](../../building-blocks/FieldOps.ServiceHost/OperationsApi.cs), [WorkOrders web](../../apps/web/src/pages/WorkOrders.tsx), native job route and work-order SQL. |
| B | [Booking/technician API](../../building-blocks/FieldOps.ServiceHost/OperationsApi.cs), [booking SQL exclusion](../../services/scheduling/migrations/002_booking_constraints.sql), [time-off FK](../../services/technicians/migrations/003_relationship_integrity.sql), SchedulingRecommendations. |
| C | [Workflow engine](../../building-blocks/FieldOps.Core/WorkflowEngine.cs), [fixed template](../../building-blocks/FieldOps.Core/WorkflowTemplates/hvac-v1.json), workflow endpoints and native/web stage forms. |
| D | [Messaging](../../building-blocks/FieldOps.ServiceHost/Messaging.cs), [ReportingApi](../../building-blocks/FieldOps.ServiceHost/ReportingApi.cs), [FaultMonitor](../../building-blocks/FieldOps.ServiceHost/FaultMonitor.cs), reporting migrations. |
| E | [Intelligence implementation](../../intelligence/fieldops_intelligence), [dispatch adapter](../../building-blocks/FieldOps.ServiceHost/SchedulingRecommendations.cs), intervention endpoint; synthetic evaluation only. |
| F | [Mobile runtime/queue](../../apps/technician-mobile/src), [security](../../building-blocks/FieldOps.ServiceHost/Security.cs), [historical verification](../testing/VERIFICATION.md). |
| G | [Customer model](../../building-blocks/FieldOps.Core/Customers.cs), [Customer API](../../building-blocks/FieldOps.ServiceHost/CustomerApi.cs), [customer001](../../services/customers/migrations/001_initial.sql), [order003](../../services/work-orders/migrations/003_customer_references.sql), [warehouse006](../../analytics/migrations/006_customer_registry.sql), Customer web/native and projector source. Applied and observed in the 16:34 live catalog. |
| G2 | [Asset model](../../building-blocks/FieldOps.Core/Assets.cs), [Asset API](../../building-blocks/FieldOps.ServiceHost/AssetApi.cs), [assets001](../../services/assets/migrations/001_initial.sql), [warehouse007](../../analytics/migrations/007_asset_registry.sql), [asset slice design](../data/ASSET_REGISTRY.md), asset web/native and projector source. Applied and observed in the 16:34 live catalog. |
| H | [Warehouse worker](../../analytics/ingestion-worker/worker.py), [SQL migrations](../../analytics/migrations), [query implementation](../../building-blocks/FieldOps.ServiceHost/WarehouseQueries.cs), [projection tests](../../tests/warehouse/test_projection.py), actual schema dictionary. |
| M1–M11 | [Domain baseline](../data/DOMAIN_DATA_MODEL.md), [live dictionary](../data/DATA_DICTIONARY.md), [physical diagrams](../data/ENTITY_RELATIONSHIP_DIAGRAMS.md); no corresponding complete model/API/client/analytics subject was found. |

Current expanded-slice execution on 2026-11-05: **75 backend, 55 web, 34 native and 41 warehouse tests pass**, plus native TypeScript validation. Evidence includes `artifacts/core-verification/core-final.trx` and ignored local test logs. Three actual Android logout/login cycles returned automatically to Home (`artifacts/native-auth/result.json`). The local API-driven batch adds **24 customers, 24 assets and 30 linked work orders** using real authenticated commands; 22 workflows are completed, six active and two unassigned. Existing records are preserved, so these are batch counts rather than whole-database totals.

The Customer browser registry/detail/history and linked-order navigation were exercised. Customer/asset broker-to-warehouse projection is live; early asset runtime-grant failures were corrected and 20 original registry events reconciled without deleting evidence (`artifacts/data/registry-reconciliation.json`). Actual technician equipment-history API returned 200 with four assigned rows after the authorization fix. Eight Prometheus scrape targets are healthy and a retained business trace was verified (`artifacts/observability.json`). The actual emulator displays customer/contact/location/consent, equipment metadata and linked history without the prior warning. Full asset editor/relocation/retirement browser coverage, complete foreign-team/role scenarios and a current-stack restore rehearsal remain separately pending. Test totals do not cover missing domains.

## Implemented operational foundation (narrow capability scope)

| ID / Feature | Data model | Migration | Backend | API | Events | Web | Android | Analytics | Tests | E2E | Overall / evidence or missing gate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F001 Work-order creation and lifecycle update | D | D | S | S | S | S | S | S | H | H | **PARTIAL** — A: lifecycle rules, resource scope and historical live checks; broader order domain remains partial. |
| F002 Customer/address snapshots on existing work orders | D | D | S | S | S | S | S | P | H | H | **PARTIAL** — A: operational strings only, deliberately redacted from analytical events; not a registry. |
| F003 Priority and service-category validation | D | D | S | S | S | S | S | S | H | H | **PARTIAL** — A: enumerated supported values; no type/incident master. |
| F004 Booking create, reschedule and cancellation | D | D | S | S | S | S | S | S | H | H | **PARTIAL** — B: authenticated owner references and source-versioned events. |
| F005 Concurrent booking exclusion and unique confirmed order | D | D | S | S | S | S | S | S | H | H | **PARTIAL** — B: GiST exclusion / partial unique index; prior real PostgreSQL parallel check. |
| F006 Technician profile skills/certification strings | D | D | S | S | S | P | P | S | H | H | **PARTIAL** — B: arrays, no proficiency/expiry or complete staff editor. |
| F007 Published working hours, timezone and availability | D | D | S | S | S | P | P | S | H | H | **PARTIAL** — B: validation and SCD2 capacity; not a shift/calendar system. |
| F008 Technician time-off interval creation | D | D | S | S | S | M | M | S | H | P | **PARTIAL** — B: same-owner FK, API and warehouse; no complete web/native editor lifecycle. |
| F009 Eight-stage ordered workflow and pinned template v1 | D | D | S | S | S | S | S | S | H | H | **PARTIAL** — C: fixed JSON template and aggregate, not general inspection authoring. |
| F010 Conditional dropdown form validation | D | D | S | S | S | S | S | P | H | H | **PARTIAL** — C: selected answers retained operationally and original event evidence; excluded from analytics. |
| F011 Server SLA warning, critical and breach thresholds | D | D | S | S | S | S | S | S | H | H | **PARTIAL** — C: server clock and recorded events, not browser authority. |
| F012 Pause, resume and supervisor override | D | D | S | S | S | S | P | S | H | H | **PARTIAL** — C: role/reason/Version, recorded intervention; native supervision not a complete office workflow. |
| F013 Technician assistance request | D | D | S | S | S | S | S | P | H | H | **PARTIAL** — C: AssistanceRequested.v1; persisted supervisor notice; no standalone warehouse assistance fact. |
| F014 Durable notifications, acknowledgment and SignalR | D | D | S | S | S | S | S | P | H | H | **PARTIAL** — D: DB commit before best-effort push; no notification analytical subject. |
| F015 Immutable event evidence and diagnostic delivery faults | D | D | S | S | S | S | N/A-O | P | H | H | **PARTIAL** — D: original evidence and fault observations; owner/admin can bypass local controls. |
| F016 Read-only event replay and incident exports | D | D | S | S | S | S | N/A-O | P | H | H | **PARTIAL** — D: Supervisor/Admin investigation; no reason for technician replay administration. |
| F017 Synthetic advisory risk prediction and recorded decision | D | D | S | S | S | S | P | S | H | H | **PARTIAL** — E: supervisor-submitted provenance, no verified model receipt or real-world accuracy. |
| F018 Single-appointment OR-Tools dispatch recommendation | P | N/A-A | S | S | N/A-A | S | N/A-O | P | H | H | **PARTIAL** — E: computed response, not persisted recommendation history; no travel provider. |
| F019 Owner-scoped offline stage draft and queued replay | D | D | S | S | S | P | S | P | H | H | **PARTIAL** — F: native AsyncStorage/SecureStore separation; historical stage-only reconnect evidence. |
| F020 Signed OIDC/PKCE and role/team/assignment authorization | D | N/A-I | S | S | N/A-I | S | S | N/A-I | H | H | **PARTIAL** — F: Keycloak-owned identity; user CRUD belongs to provider, not a custom FieldOps schema. |

## Customer slice: applied locally, acceptance remains partial

| ID / Feature | Data model | Migration | Backend | API | Events | Web | Android | Analytics | Tests | E2E | Overall / evidence or missing gate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F021 Customer registration | D | D | S | S | S | S | P | S | S | P | **PARTIAL** — G: migration/owner grants and authenticated registry creation are live; web registry/detail/history and event-derived warehouse flow exercised. Full feature-specific role/update/archive/recovery acceptance remains pending; native assigned-job customer/contact/location/consent context is observed. |
| F022 Customer list, search, filter, sort and pagination | D | D | S | S | S | S | P | S | S | P | **PARTIAL** — G: migration/owner grants and authenticated registry creation are live; web registry/detail/history and event-derived warehouse flow exercised. Full feature-specific role/update/archive/recovery acceptance remains pending; native assigned-job customer/contact/location/consent context is observed. |
| F023 Customer detail and update | D | D | S | S | S | S | P | S | S | P | **PARTIAL** — G: migration/owner grants and authenticated registry creation are live; web registry/detail/history and event-derived warehouse flow exercised. Full feature-specific role/update/archive/recovery acceptance remains pending; native assigned-job customer/contact/location/consent context is observed. |
| F024 Customer archive/reactivate status | D | D | S | S | S | S | P | S | S | P | **PARTIAL** — G: migration/owner grants and authenticated registry creation are live; web registry/detail/history and event-derived warehouse flow exercised. Full feature-specific role/update/archive/recovery acceptance remains pending; native assigned-job customer/contact/location/consent context is observed. |
| F025 Customer contact records | D | D | S | S | S | S | P | S | S | P | **PARTIAL** — G: migration/owner grants and authenticated registry creation are live; web registry/detail/history and event-derived warehouse flow exercised. Full feature-specific role/update/archive/recovery acceptance remains pending; native assigned-job customer/contact/location/consent context is observed. |
| F026 Customer-contact ownership and primary contact | D | D | S | S | S | S | P | S | S | P | **PARTIAL** — G: migration/owner grants and authenticated registry creation are live; web registry/detail/history and event-derived warehouse flow exercised. Full feature-specific role/update/archive/recovery acceptance remains pending; native assigned-job customer/contact/location/consent context is observed. |
| F027 Service-location create and update | D | D | S | S | S | S | P | S | S | P | **PARTIAL** — G: migration/owner grants and authenticated registry creation are live; web registry/detail/history and event-derived warehouse flow exercised. Full feature-specific role/update/archive/recovery acceptance remains pending; native assigned-job customer/contact/location/consent context is observed. |
| F028 Service-location archive and retained historical identity | D | D | S | S | S | S | P | S | S | P | **PARTIAL** — G: migration/owner grants and authenticated registry creation are live; web registry/detail/history and event-derived warehouse flow exercised. Full feature-specific role/update/archive/recovery acceptance remains pending; native assigned-job customer/contact/location/consent context is observed. |
| F029 Preferred communication channel | D | D | S | S | S | S | P | S | S | P | **PARTIAL** — G: migration/owner grants and authenticated registry creation are live; web registry/detail/history and event-derived warehouse flow exercised. Full feature-specific role/update/archive/recovery acceptance remains pending; native assigned-job customer/contact/location/consent context is observed. |
| F030 Email and phone communication consent | D | D | S | S | S | S | P | S | S | P | **PARTIAL** — G: migration/owner grants and authenticated registry creation are live; web registry/detail/history and event-derived warehouse flow exercised. Full feature-specific role/update/archive/recovery acceptance remains pending; native assigned-job customer/contact/location/consent context is observed. |
| F031 Consent-change audit history | D | D | S | S | S | S | P | S | S | P | **PARTIAL** — G: migration/owner grants and authenticated registry creation are live; web registry/detail/history and event-derived warehouse flow exercised. Full feature-specific role/update/archive/recovery acceptance remains pending; native assigned-job customer/contact/location/consent context is observed. |
| F032 Customer optimistic concurrency | D | D | S | S | S | S | P | S | S | P | **PARTIAL** — G: migration/owner grants and authenticated registry creation are live; web registry/detail/history and event-derived warehouse flow exercised. Full feature-specific role/update/archive/recovery acceptance remains pending; native assigned-job customer/contact/location/consent context is observed. |
| F033 Customer create idempotency | D | D | S | S | S | S | P | S | S | P | **PARTIAL** — G: migration/owner grants and authenticated registry creation are live; web registry/detail/history and event-derived warehouse flow exercised. Full feature-specific role/update/archive/recovery acceptance remains pending; native assigned-job customer/contact/location/consent context is observed. |
| F034 Registered customer/location selection in work orders | D | D | S | S | S | S | P | S | S | P | **PARTIAL** — G: migration/owner grants and authenticated registry creation are live; web registry/detail/history and event-derived warehouse flow exercised. Full feature-specific role/update/archive/recovery acceptance remains pending; native assigned-job customer/contact/location/consent context is observed. |
| F035 Explicit unregistered/legacy work-order exception | D | D | S | S | S | S | P | S | S | P | **PARTIAL** — G: migration/owner grants and authenticated registry creation are live; web registry/detail/history and event-derived warehouse flow exercised. Full feature-specific role/update/archive/recovery acceptance remains pending; native assigned-job customer/contact/location/consent context is observed. |
| F036 Assigned-technician customer/location read context | D | D | S | S | S | S | S | S | S | P | **PARTIAL** — G: migration/owner grants and authenticated registry creation are live; web registry/detail/history and event-derived warehouse flow exercised. Full feature-specific role/update/archive/recovery acceptance remains pending; native assigned-job customer/contact/location/consent context is observed. |
| F037 CustomerRegistered.v1 and CustomerUpdated.v1 outbox | D | D | S | S | S | S | P | S | S | P | **PARTIAL** — G: migration/owner grants and authenticated registry creation are live; web registry/detail/history and event-derived warehouse flow exercised. Full feature-specific role/update/archive/recovery acceptance remains pending; native assigned-job customer/contact/location/consent context is observed. |
| F038 Privacy-limited customer analytics | D | D | S | S | S | S | P | S | S | P | **PARTIAL** — G: migration/owner grants and authenticated registry creation are live; web registry/detail/history and event-derived warehouse flow exercised. Full feature-specific role/update/archive/recovery acceptance remains pending; native assigned-job customer/contact/location/consent context is observed. |
| F039 Customer source-version history and late-event reconciliation | D | D | S | S | S | S | P | S | S | P | **PARTIAL** — G: migration/owner grants and authenticated registry creation are live; web registry/detail/history and event-derived warehouse flow exercised. Full feature-specific role/update/archive/recovery acceptance remains pending; native assigned-job customer/contact/location/consent context is observed. |

## Customer service history

| ID / Feature | Data model | Migration | Backend | API | Events | Web | Android | Analytics | Tests | E2E | Overall / evidence or missing gate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F040 Customer service history and related work-order navigation | D | D | S | S | S | S | P | S | S | P | **PARTIAL** — G: real Customer browser detail/history and related-order links exercised; native assigned-job customer context is observed; full customer-centric history/role acceptance remains pending. |

## Asset domain

| ID / Feature | Data model | Migration | Backend | API | Events | Web | Android | Analytics | Tests | E2E | Overall / evidence or missing gate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F041 Equipment registry and lifecycle | D | D | S | S | S | S | P | S | S | P | **PARTIAL** — G2: owning assets service, migration, REST API, outbox events, warehouse dimension/fact, web registry and native job equipment list exist. Clean scratch migration applied, the 9-test asset suite passes, and the live service accepted an authenticated asset create. Broker/warehouse ingestion and retained-event recovery exercised; full asset browser editor and role-matrix acceptance remain pending; native assigned-job equipment/history is observed. |
| F042 Asset parent/child hierarchy | D | D | S | S | S | S | P | S | S | P | **PARTIAL** — G2: self-referencing local FK, five-level application limit and cycle rejection on update; native shows no hierarchy. |
| F043 Manufacturer catalog | P | P | P | P | N/A-A | P | P | P | P | P | **PARTIAL** — G2: manufacturer is a validated text attribute on the asset, not a separate catalog aggregate with its own lifecycle. |
| F044 Equipment model catalog | P | P | P | P | N/A-A | P | P | P | P | P | **PARTIAL** — G2: model is a validated text attribute, not a catalog with manufacturer linkage or replacement parts. |
| F045 Serial-number identity and uniqueness | D | D | S | S | S | S | P | P | S | P | **PARTIAL** — G2: case-insensitive uniqueness per team and optional unique QR identity; PostgreSQL integration tests pass; serial excluded from warehouse; full identity-conflict role acceptance and scanning remain pending. |
| F046 Installation details | P | P | S | S | S | S | P | S | S | P | **PARTIAL** — G2: installation date and location history exist; installing technician, commissioning notes and attachments do not. |
| F047 Warranty coverage and expiration | P | P | S | S | S | S | P | S | S | P | **PARTIAL** — G2: one warranty end date with expiry validation, web presentation and 90-day warehouse count; no provider, terms or claim workflow. |
| F048 Asset-to-customer ownership | D | D | S | S | S | S | P | S | S | P | **PARTIAL** — G2: customer validated through the Customer API with expected version; no cross-service FK; unit/PostgreSQL tests and authenticated registered creation pass; complete role/editor acceptance remains pending. |
| F049 Asset-to-service-location association | D | D | S | S | S | S | P | S | S | P | **PARTIAL** — G2: active owned location required and version-checked; relocation appends history. |
| F050 Asset-location change history | D | D | S | S | S | S | P | P | S | P | **PARTIAL** — G2: append-only location table with mutation trigger covered by PostgreSQL tests; web history exists; warehouse keeps only the current location. |
| F051 Asset service history | D | D | S | S | S | S | S | S | S | P | **PARTIAL** — G2: work orders store a validated asset reference; asset detail/API and the native job expose linked equipment history; live assigned-technician by-asset history returned 200 with four authorized rows; browser asset editor and broader role acceptance remain pending; native job history is observed. |
| F052 Asset-to-device association | M | M | M | M | M | M | M | M | M | M | **MISSING** — M9: no device registry or telemetry relationship exists; IoT remains unimplemented. |
| F053 QR/barcode identity and scanning | P | P | S | S | S | S | M | P | S | P | **PARTIAL** — G2: unique QR identity is stored and editable; camera scanning, labels and native scan recovery do not exist. |
| F054 Android equipment detail | D | D | S | S | S | N/A-O | P | P | S | P | **PARTIAL** — G2: assigned technician sees the customer's equipment list, the linked-asset badge and service history; no dedicated native detail or QR screen. |
| F055 Android asset history | D | D | S | S | S | N/A-O | S | S | S | P | **PARTIAL** — G2: the job shows the linked asset's work-order history, but there is no standalone native history screen; emulator job history is observed; broader role/history-navigation acceptance remains pending. |

## Expanded work-order domain

| ID / Feature | Data model | Migration | Backend | API | Events | Web | Android | Analytics | Tests | E2E | Overall / evidence or missing gate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F056 Work-order type master | M | M | M | M | M | M | M | M | M | M | **MISSING** — M2: fixed workflow dropdown selections do not implement these aggregates or financial/stock effects. |
| F057 Incident records and categorization | M | M | M | M | M | M | M | M | M | M | **MISSING** — M2: fixed workflow dropdown selections do not implement these aggregates or financial/stock effects. |
| F058 Work-order task checklist | M | M | M | M | M | M | M | M | M | M | **MISSING** — M2: fixed workflow dropdown selections do not implement these aggregates or financial/stock effects. |
| F059 Required product lines | M | M | M | M | M | M | M | M | M | M | **MISSING** — M2: fixed workflow dropdown selections do not implement these aggregates or financial/stock effects. |
| F060 Consumed product lines | M | M | M | M | M | M | M | M | M | M | **MISSING** — M2: fixed workflow dropdown selections do not implement these aggregates or financial/stock effects. |
| F061 Service line items | M | M | M | M | M | M | M | M | M | M | **MISSING** — M2: fixed workflow dropdown selections do not implement these aggregates or financial/stock effects. |
| F062 Technician labor entries | M | M | M | M | M | M | M | M | M | M | **MISSING** — M2: fixed workflow dropdown selections do not implement these aggregates or financial/stock effects. |
| F063 Estimated work-order costs | M | M | M | M | M | M | M | M | M | M | **MISSING** — M2: fixed workflow dropdown selections do not implement these aggregates or financial/stock effects. |
| F064 Actual work-order costs | M | M | M | M | M | M | M | M | M | M | **MISSING** — M2: fixed workflow dropdown selections do not implement these aggregates or financial/stock effects. |
| F065 Asset reference validation | S | S | S | S | S | S | P | S | S | P | **PARTIAL** — G2: create/link validates a team-scoped active asset against the work order's customer and location through the Assets owner; live authenticated create/link and by-asset history passed; foreign-team live denial and browser acceptance remain pending. |
| F066 Customer/asset exception authorization | M | M | M | M | M | M | M | M | M | M | **MISSING** — M2: fixed workflow dropdown selections do not implement these aggregates or financial/stock effects. |
| F067 Work-order financial cost reconciliation | M | M | M | M | M | M | M | M | M | M | **MISSING** — M2: fixed workflow dropdown selections do not implement these aggregates or financial/stock effects. |
| F068 Service report with evidence and acceptance | M | M | M | M | M | M | M | M | M | M | **MISSING** — M2: fixed workflow dropdown selections do not implement these aggregates or financial/stock effects. |

## Expanded scheduling and resource management

| ID / Feature | Data model | Migration | Backend | API | Events | Web | Android | Analytics | Tests | E2E | Overall / evidence or missing gate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F069 Persisted resource requirements | M | M | M | M | M | M | M | M | M | M | **MISSING** — M3: current bookings, profile hours, time-off create and single-job solver adapter are narrower; these full slices are missing. |
| F070 Availability calendar | M | M | M | M | M | M | M | M | M | M | **MISSING** — M3: current bookings, profile hours, time-off create and single-job solver adapter are narrower; these full slices are missing. |
| F071 Dated working shifts | M | M | M | M | M | M | M | M | M | M | **MISSING** — M3: current bookings, profile hours, time-off create and single-job solver adapter are narrower; these full slices are missing. |
| F072 Time-off update and cancellation | M | M | M | M | M | M | M | M | M | M | **MISSING** — M3: current bookings, profile hours, time-off create and single-job solver adapter are narrower; these full slices are missing. |
| F073 Territory registry and coverage | M | M | M | M | M | M | M | M | M | M | **MISSING** — M3: current bookings, profile hours, time-off create and single-job solver adapter are narrower; these full slices are missing. |
| F074 Real travel-time estimates | M | M | M | M | M | M | M | M | M | M | **MISSING** — M3: current bookings, profile hours, time-off create and single-job solver adapter are narrower; these full slices are missing. |
| F075 Crew registry | M | M | M | M | M | M | M | M | M | M | **MISSING** — M3: current bookings, profile hours, time-off create and single-job solver adapter are narrower; these full slices are missing. |
| F076 Crew booking and joint capacity | M | M | M | M | M | M | M | M | M | M | **MISSING** — M3: current bookings, profile hours, time-off create and single-job solver adapter are narrower; these full slices are missing. |
| F077 Technician-resource relationships | M | M | M | M | M | M | M | M | M | M | **MISSING** — M3: current bookings, profile hours, time-off create and single-job solver adapter are narrower; these full slices are missing. |
| F078 Persisted booking-conflict review | M | M | M | M | M | M | M | M | M | M | **MISSING** — M3: current bookings, profile hours, time-off create and single-job solver adapter are narrower; these full slices are missing. |
| F079 Persisted optimization recommendations | M | M | M | M | M | M | M | M | M | M | **MISSING** — M3: current bookings, profile hours, time-off create and single-job solver adapter are narrower; these full slices are missing. |
| F080 Recommendation approval and application history | M | M | M | M | M | M | M | M | M | M | **MISSING** — M3: current bookings, profile hours, time-off create and single-job solver adapter are narrower; these full slices are missing. |
| F081 Multi-job operational dispatch integration | M | M | M | M | M | M | M | M | M | M | **MISSING** — M3: current bookings, profile hours, time-off create and single-job solver adapter are narrower; these full slices are missing. |
| F082 Recurring booking generation | M | M | M | M | M | M | M | M | M | M | **MISSING** — M3: current bookings, profile hours, time-off create and single-job solver adapter are narrower; these full slices are missing. |

## Expanded technician qualifications

| ID / Feature | Data model | Migration | Backend | API | Events | Web | Android | Analytics | Tests | E2E | Overall / evidence or missing gate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F083 Skill proficiency levels | M | M | M | M | M | M | M | M | M | M | **MISSING** — M4: skills/certifications are strings and TeamId/SupervisorId are references, not these normalized business models. |
| F084 Certification issue and expiration dates | M | M | M | M | M | M | M | M | M | M | **MISSING** — M4: skills/certifications are strings and TeamId/SupervisorId are references, not these normalized business models. |
| F085 Expired certification eligibility checks | M | M | M | M | M | M | M | M | M | M | **MISSING** — M4: skills/certifications are strings and TeamId/SupervisorId are references, not these normalized business models. |
| F086 Technician territory membership | M | M | M | M | M | M | M | M | M | M | **MISSING** — M4: skills/certifications are strings and TeamId/SupervisorId are references, not these normalized business models. |
| F087 Technician crew membership | M | M | M | M | M | M | M | M | M | M | **MISSING** — M4: skills/certifications are strings and TeamId/SupervisorId are references, not these normalized business models. |
| F088 Availability exceptions beyond time-off create | M | M | M | M | M | M | M | M | M | M | **MISSING** — M4: skills/certifications are strings and TeamId/SupervisorId are references, not these normalized business models. |
| F089 Technician-resource relationship lifecycle | M | M | M | M | M | M | M | M | M | M | **MISSING** — M4: skills/certifications are strings and TeamId/SupervisorId are references, not these normalized business models. |

## General inspection domain

| ID / Feature | Data model | Migration | Backend | API | Events | Web | Android | Analytics | Tests | E2E | Overall / evidence or missing gate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F090 Inspection template authoring | M | M | M | M | M | M | M | M | M | M | **MISSING** — M5: fixed workflow v1 and Initial Inspection stage do not provide a general inspection domain. |
| F091 Inspection template immutable versions | M | M | M | M | M | M | M | M | M | M | **MISSING** — M5: fixed workflow v1 and Initial Inspection stage do not provide a general inspection domain. |
| F092 Inspection sections | M | M | M | M | M | M | M | M | M | M | **MISSING** — M5: fixed workflow v1 and Initial Inspection stage do not provide a general inspection domain. |
| F093 Typed inspection questions | M | M | M | M | M | M | M | M | M | M | **MISSING** — M5: fixed workflow v1 and Initial Inspection stage do not provide a general inspection domain. |
| F094 Configurable conditional rules | M | M | M | M | M | M | M | M | M | M | **MISSING** — M5: fixed workflow v1 and Initial Inspection stage do not provide a general inspection domain. |
| F095 Answer-option management | M | M | M | M | M | M | M | M | M | M | **MISSING** — M5: fixed workflow v1 and Initial Inspection stage do not provide a general inspection domain. |
| F096 Measurements and units | M | M | M | M | M | M | M | M | M | M | **MISSING** — M5: fixed workflow v1 and Initial Inspection stage do not provide a general inspection domain. |
| F097 Inspection response records | M | M | M | M | M | M | M | M | M | M | **MISSING** — M5: fixed workflow v1 and Initial Inspection stage do not provide a general inspection domain. |
| F098 Inspection evidence metadata | M | M | M | M | M | M | M | M | M | M | **MISSING** — M5: fixed workflow v1 and Initial Inspection stage do not provide a general inspection domain. |
| F099 Photo capture and storage | M | M | M | M | M | M | M | M | M | M | **MISSING** — M5: fixed workflow v1 and Initial Inspection stage do not provide a general inspection domain. |
| F100 Signature capture and storage | M | M | M | M | M | M | M | M | M | M | **MISSING** — M5: fixed workflow v1 and Initial Inspection stage do not provide a general inspection domain. |
| F101 Completed inspection version retention | M | M | M | M | M | M | M | M | M | M | **MISSING** — M5: fixed workflow v1 and Initial Inspection stage do not provide a general inspection domain. |
| F102 Inspection completion event | M | M | M | M | M | M | M | M | M | M | **MISSING** — M5: fixed workflow v1 and Initial Inspection stage do not provide a general inspection domain. |
| F103 Inspection web review | M | M | M | M | M | M | M | M | M | M | **MISSING** — M5: fixed workflow v1 and Initial Inspection stage do not provide a general inspection domain. |
| F104 Inspection Android workflow | M | M | M | M | M | M | M | M | M | M | **MISSING** — M5: fixed workflow v1 and Initial Inspection stage do not provide a general inspection domain. |
| F105 Inspection completion analytics | M | M | M | M | M | M | M | M | M | M | **MISSING** — M5: fixed workflow v1 and Initial Inspection stage do not provide a general inspection domain. |

## Agreements and preventive maintenance

| ID / Feature | Data model | Migration | Backend | API | Events | Web | Android | Analytics | Tests | E2E | Overall / evidence or missing gate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F106 Service agreements | M | M | M | M | M | M | M | M | M | M | **MISSING** — M6: no agreement, plan, recurrence or occurrence tables/services/UI/warehouse subjects. |
| F107 Agreement covered assets | M | M | M | M | M | M | M | M | M | M | **MISSING** — M6: no agreement, plan, recurrence or occurrence tables/services/UI/warehouse subjects. |
| F108 Service plans | M | M | M | M | M | M | M | M | M | M | **MISSING** — M6: no agreement, plan, recurrence or occurrence tables/services/UI/warehouse subjects. |
| F109 Recurrence-rule validation | M | M | M | M | M | M | M | M | M | M | **MISSING** — M6: no agreement, plan, recurrence or occurrence tables/services/UI/warehouse subjects. |
| F110 Maintenance occurrence ledger | M | M | M | M | M | M | M | M | M | M | **MISSING** — M6: no agreement, plan, recurrence or occurrence tables/services/UI/warehouse subjects. |
| F111 Scheduled occurrence generation | M | M | M | M | M | M | M | M | M | M | **MISSING** — M6: no agreement, plan, recurrence or occurrence tables/services/UI/warehouse subjects. |
| F112 Generated work-order linkage | M | M | M | M | M | M | M | M | M | M | **MISSING** — M6: no agreement, plan, recurrence or occurrence tables/services/UI/warehouse subjects. |
| F113 Duplicate-run maintenance idempotency | M | M | M | M | M | M | M | M | M | M | **MISSING** — M6: no agreement, plan, recurrence or occurrence tables/services/UI/warehouse subjects. |
| F114 Agreement effective/expired coverage enforcement | M | M | M | M | M | M | M | M | M | M | **MISSING** — M6: no agreement, plan, recurrence or occurrence tables/services/UI/warehouse subjects. |
| F115 Renewal information | M | M | M | M | M | M | M | M | M | M | **MISSING** — M6: no agreement, plan, recurrence or occurrence tables/services/UI/warehouse subjects. |
| F116 Maintenance compliance history | M | M | M | M | M | M | M | M | M | M | **MISSING** — M6: no agreement, plan, recurrence or occurrence tables/services/UI/warehouse subjects. |
| F117 Maintenance checklist Android view | M | M | M | M | M | M | M | M | M | M | **MISSING** — M6: no agreement, plan, recurrence or occurrence tables/services/UI/warehouse subjects. |
| F118 Maintenance compliance analytics | M | M | M | M | M | M | M | M | M | M | **MISSING** — M6: no agreement, plan, recurrence or occurrence tables/services/UI/warehouse subjects. |

## Inventory and procurement

| ID / Feature | Data model | Migration | Backend | API | Events | Web | Android | Analytics | Tests | E2E | Overall / evidence or missing gate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F119 Product catalog | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |
| F120 Supplier catalog | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |
| F121 Warehouse registry | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |
| F122 Storage-bin locations | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |
| F123 Truck-stock ownership | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |
| F124 Stock movement ledger | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |
| F125 Stock reservations | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |
| F126 Stock transfers | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |
| F127 Purchase orders | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |
| F128 Purchase-order lines | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |
| F129 Purchase receipts | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |
| F130 Purchase receipt lines | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |
| F131 Product returns | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |
| F132 Stock adjustments | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |
| F133 Parts consumption records | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |
| F134 Nonnegative stock enforcement | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |
| F135 Duplicate consumption idempotency | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |
| F136 Concurrent stock reservation | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |
| F137 Android truck-stock view | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |
| F138 Android parts consumption | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |
| F139 Work-order parts cost integration | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |
| F140 Inventory movement analytics | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |
| F141 Parts consumption analytics | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |
| F142 Purchase receipt analytics | M | M | M | M | M | M | M | M | M | M | **MISSING** — M7: partsRequired and partsStatus workflow answers do not reserve, order, receive or consume persisted stock. |

## Billing and finance

| ID / Feature | Data model | Migration | Backend | API | Events | Web | Android | Analytics | Tests | E2E | Overall / evidence or missing gate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F143 Price lists | M | M | M | M | M | M | N/A-O | M | M | M | **MISSING** — M8: operational report PDF export is not billing. Finance authoring/payment processing is office-only; technician financial administration has no required mobile screen. |
| F144 Price-list versions | M | M | M | M | M | M | N/A-O | M | M | M | **MISSING** — M8: operational report PDF export is not billing. Finance authoring/payment processing is office-only; technician financial administration has no required mobile screen. |
| F145 Service and labor rates | M | M | M | M | M | M | N/A-O | M | M | M | **MISSING** — M8: operational report PDF export is not billing. Finance authoring/payment processing is office-only; technician financial administration has no required mobile screen. |
| F146 Estimates | M | M | M | M | M | M | N/A-O | M | M | M | **MISSING** — M8: operational report PDF export is not billing. Finance authoring/payment processing is office-only; technician financial administration has no required mobile screen. |
| F147 Estimate lines | M | M | M | M | M | M | N/A-O | M | M | M | **MISSING** — M8: operational report PDF export is not billing. Finance authoring/payment processing is office-only; technician financial administration has no required mobile screen. |
| F148 Estimate approval | M | M | M | M | M | M | N/A-O | M | M | M | **MISSING** — M8: operational report PDF export is not billing. Finance authoring/payment processing is office-only; technician financial administration has no required mobile screen. |
| F149 Invoices | M | M | M | M | M | M | N/A-O | M | M | M | **MISSING** — M8: operational report PDF export is not billing. Finance authoring/payment processing is office-only; technician financial administration has no required mobile screen. |
| F150 Invoice lines | M | M | M | M | M | M | N/A-O | M | M | M | **MISSING** — M8: operational report PDF export is not billing. Finance authoring/payment processing is office-only; technician financial administration has no required mobile screen. |
| F151 Tax calculation | M | M | M | M | M | M | N/A-O | M | M | M | **MISSING** — M8: operational report PDF export is not billing. Finance authoring/payment processing is office-only; technician financial administration has no required mobile screen. |
| F152 Discount calculation | M | M | M | M | M | M | N/A-O | M | M | M | **MISSING** — M8: operational report PDF export is not billing. Finance authoring/payment processing is office-only; technician financial administration has no required mobile screen. |
| F153 Payments | M | M | M | M | M | M | N/A-O | M | M | M | **MISSING** — M8: operational report PDF export is not billing. Finance authoring/payment processing is office-only; technician financial administration has no required mobile screen. |
| F154 Customer balances | M | M | M | M | M | M | N/A-O | M | M | M | **MISSING** — M8: operational report PDF export is not billing. Finance authoring/payment processing is office-only; technician financial administration has no required mobile screen. |
| F155 Currency and decimal precision | M | M | M | M | M | M | N/A-O | M | M | M | **MISSING** — M8: operational report PDF export is not billing. Finance authoring/payment processing is office-only; technician financial administration has no required mobile screen. |
| F156 Financial rounding policy | M | M | M | M | M | M | N/A-O | M | M | M | **MISSING** — M8: operational report PDF export is not billing. Finance authoring/payment processing is office-only; technician financial administration has no required mobile screen. |
| F157 Financial audit history | M | M | M | M | M | M | N/A-O | M | M | M | **MISSING** — M8: operational report PDF export is not billing. Finance authoring/payment processing is office-only; technician financial administration has no required mobile screen. |
| F158 Duplicate invoice issuance protection | M | M | M | M | M | M | N/A-O | M | M | M | **MISSING** — M8: operational report PDF export is not billing. Finance authoring/payment processing is office-only; technician financial administration has no required mobile screen. |
| F159 Work-order invoice generation | M | M | M | M | M | M | N/A-O | M | M | M | **MISSING** — M8: operational report PDF export is not billing. Finance authoring/payment processing is office-only; technician financial administration has no required mobile screen. |
| F160 Invoice PDF | M | M | M | M | M | M | N/A-O | M | M | M | **MISSING** — M8: operational report PDF export is not billing. Finance authoring/payment processing is office-only; technician financial administration has no required mobile screen. |
| F161 Invoice-line analytics | M | M | M | M | M | M | N/A-O | M | M | M | **MISSING** — M8: operational report PDF export is not billing. Finance authoring/payment processing is office-only; technician financial administration has no required mobile screen. |
| F162 Payment analytics | M | M | M | M | M | M | N/A-O | M | M | M | **MISSING** — M8: operational report PDF export is not billing. Finance authoring/payment processing is office-only; technician financial administration has no required mobile screen. |

## Connected equipment and IoT

| ID / Feature | Data model | Migration | Backend | API | Events | Web | Android | Analytics | Tests | E2E | Overall / evidence or missing gate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F163 Device registry | M | M | M | M | M | M | M | M | M | M | **MISSING** — M9: SLA notifications are workflow events, not connected-device telemetry or equipment rules. |
| F164 Asset-device relationships | M | M | M | M | M | M | M | M | M | M | **MISSING** — M9: SLA notifications are workflow events, not connected-device telemetry or equipment rules. |
| F165 Telemetry definitions | M | M | M | M | M | M | M | M | M | M | **MISSING** — M9: SLA notifications are workflow events, not connected-device telemetry or equipment rules. |
| F166 Telemetry readings | M | M | M | M | M | M | M | M | M | M | **MISSING** — M9: SLA notifications are workflow events, not connected-device telemetry or equipment rules. |
| F167 Alert-rule configuration | M | M | M | M | M | M | M | M | M | M | **MISSING** — M9: SLA notifications are workflow events, not connected-device telemetry or equipment rules. |
| F168 Equipment alerts | M | M | M | M | M | M | M | M | M | M | **MISSING** — M9: SLA notifications are workflow events, not connected-device telemetry or equipment rules. |
| F169 Alert acknowledgments | M | M | M | M | M | M | M | M | M | M | **MISSING** — M9: SLA notifications are workflow events, not connected-device telemetry or equipment rules. |
| F170 Alert-to-work-order association | M | M | M | M | M | M | M | M | M | M | **MISSING** — M9: SLA notifications are workflow events, not connected-device telemetry or equipment rules. |
| F171 Bounded idempotent alert-generated orders | M | M | M | M | M | M | M | M | M | M | **MISSING** — M9: SLA notifications are workflow events, not connected-device telemetry or equipment rules. |
| F172 Android relevant equipment alerts | M | M | M | M | M | M | M | M | M | M | **MISSING** — M9: SLA notifications are workflow events, not connected-device telemetry or equipment rules. |
| F173 Telemetry retention policy | M | M | M | M | M | M | M | M | M | M | **MISSING** — M9: SLA notifications are workflow events, not connected-device telemetry or equipment rules. |
| F174 Equipment alert analytics | M | M | M | M | M | M | M | M | M | M | **MISSING** — M9: SLA notifications are workflow events, not connected-device telemetry or equipment rules. |

## AI knowledge and automation expansion

| ID / Feature | Data model | Migration | Backend | API | Events | Web | Android | Analytics | Tests | E2E | Overall / evidence or missing gate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F175 Knowledge documents | M | M | M | M | M | M | M | M | M | M | **MISSING** — M10: existing synthetic predictor/solver and advisory decisions do not implement these persistent automation subjects. |
| F176 Document ingestion metadata | M | M | M | M | M | M | M | M | M | M | **MISSING** — M10: existing synthetic predictor/solver and advisory decisions do not implement these persistent automation subjects. |
| F177 Configurable model registry | M | M | M | M | M | M | M | M | M | M | **MISSING** — M10: existing synthetic predictor/solver and advisory decisions do not implement these persistent automation subjects. |
| F178 AI-assisted drafts | M | M | M | M | M | M | M | M | M | M | **MISSING** — M10: existing synthetic predictor/solver and advisory decisions do not implement these persistent automation subjects. |
| F179 Draft approval records | M | M | M | M | M | M | M | M | M | M | **MISSING** — M10: existing synthetic predictor/solver and advisory decisions do not implement these persistent automation subjects. |
| F180 Automation rule authoring | M | M | M | M | M | M | M | M | M | M | **MISSING** — M10: existing synthetic predictor/solver and advisory decisions do not implement these persistent automation subjects. |
| F181 Automation execution history | M | M | M | M | M | M | M | M | M | M | **MISSING** — M10: existing synthetic predictor/solver and advisory decisions do not implement these persistent automation subjects. |
| F182 Webhook subscriptions | M | M | M | M | M | M | M | M | M | M | **MISSING** — M10: existing synthetic predictor/solver and advisory decisions do not implement these persistent automation subjects. |
| F183 Webhook deliveries | M | M | M | M | M | M | M | M | M | M | **MISSING** — M10: existing synthetic predictor/solver and advisory decisions do not implement these persistent automation subjects. |
| F184 Webhook failure and retry records | M | M | M | M | M | M | M | M | M | M | **MISSING** — M10: existing synthetic predictor/solver and advisory decisions do not implement these persistent automation subjects. |

## Expanded technician device workflows

| ID / Feature | Data model | Migration | Backend | API | Events | Web | Android | Analytics | Tests | E2E | Overall / evidence or missing gate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F185 Native camera permissions and photo evidence | M | M | M | M | M | M | M | M | M | M | **MISSING** — M11: existing offline stage queue does not automatically support these action types, permissions, attachments or invariants. |
| F186 Native signature input | M | M | M | M | M | M | M | M | M | M | **MISSING** — M11: existing offline stage queue does not automatically support these action types, permissions, attachments or invariants. |
| F187 Technician time tracking | M | M | M | M | M | M | M | M | M | M | **MISSING** — M11: existing offline stage queue does not automatically support these action types, permissions, attachments or invariants. |
| F188 Parts consumption offline drafts | M | M | M | M | M | M | M | M | M | M | **MISSING** — M11: existing offline stage queue does not automatically support these action types, permissions, attachments or invariants. |
| F189 Truck stock offline view | M | M | M | M | M | M | M | M | M | M | **MISSING** — M11: existing offline stage queue does not automatically support these action types, permissions, attachments or invariants. |
| F190 Inspection offline drafts | M | M | M | M | M | M | M | M | M | M | **MISSING** — M11: existing offline stage queue does not automatically support these action types, permissions, attachments or invariants. |
| F191 Maintenance offline checklist | M | M | M | M | M | M | M | M | M | M | **MISSING** — M11: existing offline stage queue does not automatically support these action types, permissions, attachments or invariants. |
| F192 Asset QR permission and scan recovery | M | M | M | M | M | M | M | M | M | M | **MISSING** — M11: existing offline stage queue does not automatically support these action types, permissions, attachments or invariants. |
| F193 Service-report offline drafts | M | M | M | M | M | M | M | M | M | M | **MISSING** — M11: existing offline stage queue does not automatically support these action types, permissions, attachments or invariants. |
| F194 Per-feature synchronization state | M | M | M | M | M | M | M | M | M | M | **MISSING** — M11: existing offline stage queue does not automatically support these action types, permissions, attachments or invariants. |
| F195 Per-feature conflict recovery | M | M | M | M | M | M | M | M | M | M | **MISSING** — M11: existing offline stage queue does not automatically support these action types, permissions, attachments or invariants. |
| F196 Restart-safe new-domain drafts | M | M | M | M | M | M | M | M | M | M | **MISSING** — M11: existing offline stage queue does not automatically support these action types, permissions, attachments or invariants. |

## Implemented warehouse platform, with limits

| ID / Feature | Data model | Migration | Backend | API | Events | Web | Android | Analytics | Tests | E2E | Overall / evidence or missing gate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F197 Work-order accumulating fact and known-creation cohort | D | D | S | S | S | S | N/A-O | S | H | H | **PARTIAL** — H: actual dimensional warehouse, independent ingestion and existing report. |
| F198 Workflow-stage duration/SLA fact and charts | D | D | S | S | S | S | N/A-O | S | H | H | **PARTIAL** — H: known valid durations; excludes unknown rather than inventing zero. |
| F199 Booking snapshot and utilization function | D | D | S | S | S | S | N/A-O | S | H | H | **PARTIAL** — H: booking overlap population differs from order creation cohort. |
| F200 Technician SCD2 history | D | D | S | S | S | S | N/A-O | S | H | H | **PARTIAL** — H: implemented epochs/exclusion and late-split tests; only observed retained history. |
| F201 Time-off analytical projection | D | D | S | S | S | S | N/A-O | S | H | H | **PARTIAL** — H: reason redacted; overlapping intervals summed/capped, not unioned. |
| F202 Supervisor interventions and breach event facts | D | D | S | S | S | S | N/A-O | S | H | H | **PARTIAL** — H: events vs affected-order share have different grains. |
| F203 Event hash ledger, safe staging and duplicate rejection | D | D | S | N/A-A | S | N/A-A | N/A-O | S | H | H | **PARTIAL** — H: ingestion internal contract, no separate end-user API/screen required. |
| F204 Archive reconciliation and bounded backfill | D | D | S | N/A-A | S | N/A-A | N/A-O | S | H | H | **PARTIAL** — H: operator CLI; supplied archive completeness not proven. |
| F205 Warehouse quality checks | D | D | S | N/A-A | N/A-A | N/A-A | N/A-O | S | H | P | **PARTIAL** — H: SELECT defect checks; no live data-quality operator dashboard. |
| F206 Reporting CSV/PDF with authorized persisted data | D | D | S | S | S | S | N/A-O | S | H | H | **PARTIAL** — H: order report exports; not billing/service-report evidence. |

## Cross-cutting acceptance gaps for expanded domains

| ID / Feature | Data model | Migration | Backend | API | Events | Web | Android | Analytics | Tests | E2E | Overall / evidence or missing gate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F207 Clean-database application of every new migration | M | M | M | M | M | M | M | M | M | M | **MISSING** — GATE: an existing platform mechanism or source test does not establish these checks for every new feature; pending expanded-slice execution. |
| F208 Existing-data upgrade of every new migration | M | M | M | M | M | M | M | M | M | M | **MISSING** — GATE: an existing platform mechanism or source test does not establish these checks for every new feature; pending expanded-slice execution. |
| F209 Recovery/rollback procedure for every new migration | M | M | M | M | M | M | M | M | M | M | **MISSING** — GATE: an existing platform mechanism or source test does not establish these checks for every new feature; pending expanded-slice execution. |
| F210 New-domain role and resource authorization tests | M | M | M | M | M | M | M | M | M | M | **MISSING** — GATE: an existing platform mechanism or source test does not establish these checks for every new feature; pending expanded-slice execution. |
| F211 New-domain API validation/error tests | M | M | M | M | M | M | M | M | M | M | **MISSING** — GATE: an existing platform mechanism or source test does not establish these checks for every new feature; pending expanded-slice execution. |
| F212 New-domain event contract/consumer tests | M | M | M | M | M | M | M | M | M | M | **MISSING** — GATE: an existing platform mechanism or source test does not establish these checks for every new feature; pending expanded-slice execution. |
| F213 New-domain browser E2E | M | M | M | M | M | M | M | M | M | M | **MISSING** — GATE: an existing platform mechanism or source test does not establish these checks for every new feature; pending expanded-slice execution. |
| F214 New-domain native emulator E2E | M | M | M | M | M | M | M | M | M | M | **MISSING** — GATE: an existing platform mechanism or source test does not establish these checks for every new feature; pending expanded-slice execution. |
| F215 New-domain warehouse ingestion E2E | M | M | M | M | M | M | M | M | M | M | **MISSING** — GATE: an existing platform mechanism or source test does not establish these checks for every new feature; pending expanded-slice execution. |
| F216 New-domain reconciliation/freshness checks | M | M | M | M | M | M | M | M | M | M | **MISSING** — GATE: an existing platform mechanism or source test does not establish these checks for every new feature; pending expanded-slice execution. |
| F217 New-domain concurrency tests | M | M | M | M | M | M | M | M | M | M | **MISSING** — GATE: an existing platform mechanism or source test does not establish these checks for every new feature; pending expanded-slice execution. |
| F218 New-domain failure recovery tests | M | M | M | M | M | M | M | M | M | M | **MISSING** — GATE: an existing platform mechanism or source test does not establish these checks for every new feature; pending expanded-slice execution. |
| F219 New-domain observability and correlation | M | M | M | M | M | M | M | M | M | M | **MISSING** — GATE: an existing platform mechanism or source test does not establish these checks for every new feature; pending expanded-slice execution. |
| F220 New-domain backup/restore verification | M | M | M | M | M | M | M | M | M | M | **MISSING** — GATE: an existing platform mechanism or source test does not establish these checks for every new feature; pending expanded-slice execution. |

## Not verified or not implemented (2026-11-05)

- Customer and Asset owners, scoped runtime roles, applied migrations, real command/event/warehouse flows and narrow live history paths are verified locally. Full asset browser editing/relocation/retirement and complete role-matrix acceptance remain pending; native customer/equipment/history context is observed without the previous warning.
- A complete fresh installation and restore-based upgrade rehearsal of the expanded stack is not yet recorded. No production/off-host recovery objective or cloud deployment is established.
- QR scanning, manufacturer/model catalogs, warranty claims, device associations and telemetry remain unimplemented.
- Expanded scheduling, general inspections, preventive maintenance, inventory, billing, IoT, configurable AI/automation and the broader work-order/labor/cost domain remain **MISSING** or **PARTIAL** as individually recorded above. Existing narrow scheduling/workflow/advisory capabilities remain available.
- Presentation media and screenshots are archived outside the repository at the user's request; runtime code, tests, data documentation and infrastructure remain in scope.

## Continuous update procedure

This baseline contains **220 individual capability rows**. For each changed slice, update the specific rows and evidence, rerun the catalog/render scripts after actual migration, record clean-install and upgrade results, execute required role/validation/concurrency/event/warehouse checks, and verify the real browser/native workflow. Preserve the original snapshot as baseline evidence. Link exact current reports rather than copying historical totals.

Customer create/update must include contact/location integrity, explicit legacy exceptions, authorized order selection, privacy-safe customer events, warehouse source-version reconciliation and assigned-technician context. The broader asset requirements remain partial; inventory/maintenance/billing/inspection/IoT modules remain missing even if Customer is eventually completed. A layer may be marked N/A only with a specific architectural/user-role justification; existing platform outbox/auth/offline infrastructure cannot be credited as an implemented new-domain consumer, permission, UI or sync action.

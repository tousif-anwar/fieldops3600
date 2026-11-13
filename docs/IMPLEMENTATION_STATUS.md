# FieldOps 360 implementation status

Current local status: **2026-11-05**. The web application and Android development app run against the local stack. Customer and asset registration, linked work orders, guided workflows, scheduling, notifications, reports and operational replay are available. The broader enterprise expansion remains **PARTIAL**; the [feature completion matrix](engineering/FULL_STACK_FEATURE_COMPLETION_MATRIX.md) records individual implemented and missing capabilities.

## Running application and data

| Area | Current implementation / observed evidence |
|---|---|
| Backend | Eight .NET 10 service hosts: customers, assets, work orders, technicians, scheduling, workflows, notifications and reporting; YARP gateway; Keycloak authorization-code/PKCE authentication |
| Data ownership | Nine FieldOps databases, including the independent warehouse; 71 physical tables, 35 local physical FKs, six views and 28 applied migration entries in the 2026-11-05 16:34 UTC catalog |
| Customers and assets | Owner-scoped registry APIs, web editors/history, version checks, append-only change history, privacy-limited events and analytical projections. Work orders validate logical customer/location/asset references; legacy exceptions retain explicit reasons and original snapshots |
| Synthetic demonstration records | API-driven batch of 24 customers, 24 assets and 30 linked orders, preserving existing data. Twenty-two workflows completed, six active and two unassigned; these are batch counts, not total database populations |
| Warehouse | Ten dimensions and eight facts; technician SCD2 epochs, history-aware capacity and time-off/weekend exclusions. Customer revisions use source-version snapshots rather than temporal SCD2. Current asset and linked-order projections are event-derived |
| Android | Installed debug development app on `emulator-5556`; real Keycloak login and SecureStore session. Three logout/login cycles returned automatically to Home. Live job customer/contact/location/consent, equipment metadata and equipment service history are visible without the prior unavailable-history warning |
| Monitoring | Eight healthy Prometheus application targets, Grafana dashboard/login and RabbitMQ management access verified; retained business trace with 15 spans verified. Credentials remain in ignored local configuration; [monitoring guide](operations/MONITORING.md) explains demonstrations |

The local metadata capture is documented in the [data dictionary](data/DATA_DICTIONARY.md) and [physical diagrams](data/ENTITY_RELATIONSHIP_DIAGRAMS.md). Separate owner/runtime identities are verified for all eight services. Original registry events were reconciled after correcting an early warehouse grant omission; retained originals and ledger identities were preserved.

## Current verification

| Check | Result | Boundary |
|---|---|---|
| Backend | **75/75 passed** | Domain and PostgreSQL/migration/resource tests; .NET 10.0.403 used on this host |
| Web | **55/55 passed**, TypeScript and production build passed | Includes customer/asset contracts and actual registry-insights aggregate rendering; current live browser suite rerun is pending |
| Native source | **34/34 passed**, TypeScript passed | Session, offline queue, forms and customer/asset context contracts |
| Warehouse | **41/41 passed** | PostgreSQL projections, duplicate/late/version/privacy cases and linked asset preservation |
| Warehouse data quality | **33 SELECT checks, zero defects** | Executed against the configured local warehouse; not every proposed new-domain invariant |
| Native UI | Three real logout/login cycles passed; live customer/equipment/history observed | Android emulator development build; full native offline/conflict/physical-device acceptance is separate |
| Observability | Eight targets healthy; 15 retained business spans | Bounded local monitoring/trace retention, not a production availability guarantee |

The [historical verification record](testing/VERIFICATION.md) preserves earlier execution results. Historical counts and older live E2E results do not establish acceptance of the current expanded source. Ignored local logs, TRX and JSON reports retain current execution evidence; generated credentials, screenshots and media are not source deliverables.

## Remaining scope and limitations

- Full asset browser editor/relocation/retirement and complete foreign-team/role acceptance remain pending. Current live web E2E verification is still being completed; no final result is claimed here.
- The expanded stack still needs a complete fresh-install and restore-based populated-upgrade rehearsal. No production off-host restore objective, load/capacity certification, external CI run or cloud deployment is established.
- General inspection authoring/evidence, preventive-maintenance agreements/recurrence, inventory/procurement/stock, pricing/invoices/payments, IoT devices/telemetry/alerts and configurable knowledge/automation/webhooks remain missing. Expanded labor/cost/crew/territory requirements remain partial or missing.
- QR identity storage exists; QR scanning does not. Manufacturer/model values are attributes rather than separate catalogs. Warranty claims and standalone native equipment administration are absent.
- Technician utilization excludes recorded time off and defaults to weekdays, but overlapping absence intervals are summed/capped rather than unioned. Cross-service HTTP validation is not a distributed serializable transaction. SignalR delivery is best effort; persisted state is authoritative.
- Native offline drafts use AsyncStorage and are not application-encrypted. No iOS execution, signed mobile store release or physical-device certification is claimed. The advisory risk model uses synthetic data and has no established real-world accuracy.
- Hostinger deployment is **not implemented**. The inspected account did not expose an existing VPS; server/account/domain/access details remain unresolved. The local Compose identity settings and URLs require a reviewed production configuration before deployment; see [Hostinger status](deployment/HOSTINGER.md).

Presentation media and screenshots have been archived outside this repository at the user's request. The repository retains runtime clients/server code, essential data/docs/infrastructure and verification tools.

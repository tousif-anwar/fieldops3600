# Operational verification and demonstration

Current source verification, November 14, 2026. This extends the earlier release snapshot; `FieldOps360_Final_Project.zip` has not been regenerated. The current local application is at <http://localhost:8088>. Business rules, service ownership, data retention boundaries and prioritized remaining work are in [Business operations](BUSINESS_OPERATIONS.md).

## Observed automated results

Commands run from the repository root unless another directory is stated. Windows uses the existing private .NET SDK at `.tools/dotnet/dotnet.exe`; the globally installed SDK is not the pinned project SDK. Tests use synthetic data, real signed Keycloak identities, actual service databases and RabbitMQ where applicable.

| Check | Exact command | Observed result |
|---|---|---|
| Backend domain/PostgreSQL | `.\.tools\dotnet\dotnet.exe test tests/backend/FieldOps.Tests.csproj --no-restore -c Release --logger "trx;LogFileName=operational-final.trx" --results-directory artifacts/operations` | **118 passed, 0 failed, 0 skipped** |
| Work-packet event privacy | `.\.tools\dotnet\dotnet.exe test tests/backend/FieldOps.Tests.csproj --no-restore -c Release --filter "FullyQualifiedName~WorkOrderRuleTests"` | **8 passed** after confirming reported-problem text stays outside general order event payloads |
| Customer lifecycle | `python tests/backend/verify_customer_lifecycle_http.py -v` | **3 passed**: organization isolation, concurrent qualification and complete request-to-report lifecycle |
| Assignment offers | `python tests/backend/verify_assignment_offers_http.py -v` | **6 passed** on final deployed service images |
| Scheduling races/warehouse | `python tests/backend/verify_scheduling_races_http.py -v` | **3 passed**: booking/cancellation fence, execution/cancellation claim, deployed warehouse offer evidence |
| Existing integration regression | `python -m unittest discover -s tests/integration -v` | **5 passed**, 225.137 seconds |
| Scoped resource authorization | `python tests/backend/verify_resource_authorization_http.py -v` | **3 passed**, 97.313 seconds |
| Web build | `npm run build` in `apps/web` | TypeScript and Vite production build passed |
| Web unit/components | `npm test` in `apps/web` | **68 passed**, 15 test files, 72.65 seconds, after the final work-packet display addition |
| Web formatting | `npm run format:check` in `apps/web` | Passed after the final work-packet display change |
| Full deployed browser regression | `$env:FIELDOPS_LIVE_E2E='1'; $env:WEB_BASE_URL='http://localhost:8088'; npx playwright test --workers=1` in `apps/web` | **29 passed, 13 intentionally skipped**, 42 configured cases, 1.4 minutes |
| Focused deployed customer browser | Same environment, `npx playwright test e2e/customer-intake.spec.ts --project=chromium --workers=1` | **2 passed**, 14.6 seconds: intake/isolation/qualification/offers and completed-report dialog/navigation |
| Final reported-problem browser handoff | Same environment, `npx playwright test e2e/customer-intake.spec.ts --project=chromium --workers=1 --grep 'customer intake is isolated'` | **1 passed**, 10.1 seconds, after the final web rebuild; exact customer description appears in the work-order detail |
| Mobile source | `npm run check` in `apps/technician-mobile` | TypeScript and **43 tests passed** |
| Android offline runtime | `python apps/technician-mobile/scripts/verify-android-offline.py --serial emulator-5556` | **Passed** on the actual Android emulator; details below |
| Android offers/service runtime | `python apps/technician-mobile/scripts/verify-android-operations.py --serial emulator-5556` | **Passed** on actual native controls; all eight v2 stages completed |
| Warehouse PostgreSQL | `docker compose run --rm --no-deps -v 'C:/Users/tousi/Downloads/fieldops3600:/repo:ro' migrate-warehouse python /repo/tests/warehouse/test_projection.py -v` | **34 passed**; use your repository's absolute path on another machine |
| Optimizer | `$env:PYTHONPATH='optimizer'; $env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'; python -m pytest -c optimizer/pyproject.toml tests/optimizer -q` | **10 passed**; one FastAPI/Starlette test-client deprecation warning |
| Gateway | `.\.tools\dotnet\dotnet.exe build gateway/FieldOps.Gateway.csproj --no-restore -c Release`, then `$env:GATEWAY_BUILD_CONFIGURATION='Release'; python tests/security/test_gateway.py -v` | Build passed without warnings/errors; **7 security tests passed** |
| Database identities | `python scripts/verify-database-permissions.py` | Passed: eight isolated runtime identities, append-only evidence and warehouse reader/writer boundaries |
| Compose configuration | `docker compose config --quiet` | Passed |
| Documentation | `python scripts/check-docs.py` | Passed: 63 relative links in 16 maintained files |
| Local credential guard | `python scripts/check-secrets.py` | Passed for 379 repository files; generated credentials remain ignored |
| Patch whitespace | `git diff --check` | Passed |
| Local bootstrap/upgrade | `python scripts/test-local-bootstrap.py` | **5 passed**, including signed customer-claim mapper generation, credential preservation and allowlisted additive context creation |

The full browser run preceded the additive reported-problem display. That addition is separately checked through targeted components, production compilation and actual authorized data. The 13 browser skips are explicit desktop-only role/customer scenarios in the mobile Chromium project. They are not executed mobile-device tests.

The backend tests include actual PostgreSQL races and rollback, immutable migration checksums, exclusive booking and pending-offer indexes, terminal decision integrity, v1 compatibility, v2 legal/illegal progression, bounded invariant-decimal labor, customer claims, stage/SLA versions, outbox/inbox and append-only replay evidence. The live suites additionally test real authorization and network/service integration.

An older bootstrap assertion assumed reconciliation could never create a database. It was corrected to verify the existing intended upgrade policy: only missing customer/asset databases and owners may be created under explicit existence guards; no database may be dropped, existing owner passwords must not rotate, and other owner credentials must remain absent. The Customer role/claim mapper is now covered by the same source regression suite.

## Actual Android evidence

This is native development-client runtime verification, separate from TypeScript/source tests. The local emulator runs the current Expo application through Metro and signs in using real Keycloak PKCE.

The offline check:

1. Created a labeled synthetic assignment and workflow through authenticated APIs.
2. Loaded the cached job and stage controls on Android.
3. Enabled airplane mode and disabled Wi-Fi, queued a stage, and verified that the authoritative server stage did not advance.
4. Force-stopped/relaunched the app while offline and observed the original queued answers in Sync.
5. Restored connectivity and verified automatic synchronization advanced exactly one stage with the original answers.

The operations check accepted an offer through native confirmation and observed exactly one confirmed booking. It declined another offer with a persisted reason and no booking. It then completed all eight template-v2 stages through Android controls, including diagnostic text, work performed, decimal labor `30.5`, customer confirmation and final recommendations. The server reported `Completed`; the native completed job displayed **Service complete** rather than a running final-stage SLA.

A separate read-only Android check also verified that the full reported-problem text on an existing customer-qualified job exactly matched the authorized technician API record. Its generated evidence is `.local/mobile-reported-problem-verification.json`.

Generated local evidence (ignored by Git) is `.local/mobile-android-offline-verification.json` and `.local/mobile-android-operations-verification.json`. The scripts are committed source and can reproduce the checks. See [mobile operating instructions](../apps/technician-mobile/MOBILE_OPERATIONS.md).

These checks do not certify iOS, physical devices, release APK distribution, background execution, camera uploads, file attachments or customer signatures. Offline stage evidence is supported; offers, workflow creation, financial approvals and inventory authority are not silently queued as authoritative decisions.

## Browser and visual checks

The deployed browser tests exercised actual Customer and dispatcher sign-in, request submission, cross-customer isolation, qualification, offer creation, absence of a falsely confirmed appointment, service-report reading, and navigation after closing dialogs. The portal was checked at 375, 1024 and 1440 pixels for horizontal overflow. The broader suite exercised all existing operational roles, registry, scheduling, replay and login flows.

A visual inspection of the generated report screenshot confirmed bounded report scrolling and a visible Close action. This visual inspection supplements automated checks; it is not a full accessibility or assistive-technology audit. During verification, controlled dialog closure and scrollable Fluent dialog content were corrected, as was native text rendering in notices.

Generated browser screenshots/traces live under `apps/web/test-results/`. Backend TRX files are under `artifacts/operations/`; final HTTP/browser logs are under `.local/operations-*-final.log`. These directories are local evidence and remain ignored.

## Feature inventory

| Capability | Status | Practical boundary |
|---|---|---|
| Customer organization/location/equipment isolation | Implemented and verified locally | Provisioned single-organization identities; no self-registration |
| Request submission and dispatcher qualification | Implemented and verified locally | Appointment only committed separately; reported problem retained in work packet |
| Direct qualified bookings and conflict prevention | Implemented and verified locally | No road-routing/parts/territory constraints |
| Offer, accept, decline, revoke, expiration | Implemented and verified locally | Exclusive single-technician offers, not broadcast marketplaces or capacity reservations |
| Scheduling event ordering and cancellation/start races | Implemented and verified locally | Durable scheduling revision/claims/fences; profile/time-off remain separate-service validations |
| Technician Home, itinerary, directions and activity | Implemented and verified locally | Actual appointments/stages; navigation handoff, not an embedded route optimizer or attendance clock |
| v2 service evidence and completion guards | Implemented and verified locally | Documentary parts/labor and acknowledgment; no inventory transaction or financial approval |
| Offline durable stage submission | Implemented and verified on Android emulator | Actual restart/reconnect tested; not all mobile platforms or offline media |
| Generated completed service report | Implemented and verified locally | Stored answers and pinned labels, no invented invoice/signature |
| Staff in-app notifications and replay | Implemented and verified locally | Eventual delivery/history; no external provider receipts |
| Operational warehouse analytics | Implemented and verified locally | Actual event facts; no financial, contract, request-funnel or payroll metrics |
| Availability and approved time off | Partially implemented for broader shift requirement | Existing hours/skills/time-off checks; no attendance/rest/overtime/on-call lifecycle |
| SLA management | Partially implemented for broader SLA requirement | Existing stage-execution SLA; no contract/emergency arrival or business-calendar targets |
| Unstarted reassignment | Partially implemented | Cancel/rebook and revoke/reoffer; active-service transfer intentionally blocked |
| Follow-up/parts blockers | Partially implemented | Assistance, supervisor pause/exception and follow-up evidence; no linked return-visit or stock workflow |
| Customer appointment options/self-booking | Not implemented | Portal can request service and read committed appointments |
| Inventory/reservations/transfers/consumption | Not implemented | Parts text is explicitly documentary |
| Maintenance contracts/entitlements/recurrence | Not implemented | A Maintenance service type does not validate coverage or generate visits |
| Estimates, customer e-signatures and financial authorization | Not implemented | Technician-recorded service acknowledgment is a separate capability |
| Billing/job costing/internal invoices | Not implemented | Labor minutes do not imply payroll or monetary calculations |
| External customer notifications and preferences | Not implemented | Customer status polling/report reads work; no sent/delivered messages are invented |
| Media storage, attachment security and retention automation | Not implemented | No verified photo/signature pipeline |
| Dataverse/Power Automate adapter | Not implemented | Conceptual mapping only; official reference links in business documentation |
| Production deployment/certification | Not implemented | Local Compose, development HTTP and synthetic accounts only |

## Reproducible primary demonstration

From the source root, start or update the local services with the normal migration jobs:

```powershell
python scripts/init-local.py
docker compose up -d --build
python scripts/wait-local.py
python scripts/seed-customer-portal.py
```

Existing generated identities/passwords are preserved. The shared local demonstration password remains in the ignored root `.env`; the seed does not print it. Open <http://localhost:8088> in separate sessions for the `customer` and `dispatcher` accounts. `customer-other` is an isolated second organization for authorization demonstrations.

1. **Customer:** choose an active service location, optional owned equipment, service type and urgency; enter the problem and submit. The request is Submitted and has no appointment.
2. **Dispatcher:** open Service requests, review the description, approve with an explicit qualification reason, category and priority. Open the resulting work order in scheduling. Qualification creates exactly one order and retains the reported problem.
3. **Dispatcher:** either confirm a feasible direct assignment or choose offer mode with an eligible technician, appointment window and future response deadline. A Pending offer is visibly not a confirmed visit.
4. **Technician:** sign in to the native app, review the offer and accept online. Verify the confirmed job, destination, reported problem, appointment and server-controlled workflow. The itinerary preserves dispatch order; Directions opens the destination in the navigation app.
5. **Technician:** complete the eight forms. For a routine resolved demonstration use Ready, Arrived/Accessible, no safety concern, diagnosis/notes and No parts required, successful service with work performed and labor minutes, passing quality checks, informed/accepted customer, and Resolved/Operational plus a written summary/recommendation. A failure or missing part is handled through assistance and documented supervisor action.
6. **Customer:** refresh service history and open the stored completed report. Verify diagnosis, work performed, labor, equipment status and recommendations.
7. **Supervisor/Analyst:** use the authorized replay/analytics workspace. Operational completion is synchronous in workflows; order, notification and warehouse projections converge through the actual event pipeline.

An automated version is `python tests/backend/verify_customer_lifecycle_http.py -v`. The focused browser test requires its completed customer fixture; run the portal seed and lifecycle check first. CI now includes these seed/HTTP steps before Playwright.

## Requested scenario coverage

| Scenario | Executable result and remaining work |
|---|---|
| A Routine maintenance | Generic maintenance intake/qualified service path exists; contract coverage is not implemented, so the full contract scenario is partial. |
| B Emergency repair | Customer urgency and dispatcher priority are stored; dedicated emergency response SLA/escalation/insertion remains partial. |
| C Declined offer | Verified through signed APIs and native controls; reason retained, no booking, new offer allowed. |
| D No connectivity | Verified actual Android cached stage, OS disconnection, app restart and exactly-once synchronization. |
| E Missing part | Backend blocks Ordered-parts progression and supports assistance/pause; reservation/fulfillment/return visit remains unimplemented. |
| F Scope approval | Financial estimate/scope approval is unimplemented; service acknowledgment must not be presented as this scenario. |
| G Running late | Assistance can retain a delay reason; automatic route risk/customer communication is unimplemented. |
| H Reassignment | Pending-offer revocation/direct booking and unstarted cancellation paths are verified; active workflow transfer is deliberately blocked. |
| I Completion/closeout | Verified guided service/report/customer visibility/replay; billing and separate supervisor financial closeout remain unimplemented. |
| J Recurring contracts | Not implemented; no duplicate-preventing recurrence/entitlement claim is made. |

## Recovery and remaining verification

If scheduling commits a service-start claim and workflow persistence fails, retry workflow creation with the authorized technician. The claim remains idempotent and protects the appointment. If a work-order cancellation intent commits before an order write/version conflict, refresh and retry cancellation; new allocation stays fenced. There is no automatic timeout or unaudited release that could silently reassign active work. An audited supervisor recovery/release interface is a future requirement.

Qualification changes/time off reside in another service and are revalidated over APIs rather than in one distributed serializable transaction. External routing, customer communications, accounting and Microsoft integration are not connected. No production load, failover, backup/restore, penetration test, physical-device certification or remote CI result is claimed. The separate prioritized backlog in [Business operations](BUSINESS_OPERATIONS.md#prioritized-remaining-work) identifies the next complete vertical slices.

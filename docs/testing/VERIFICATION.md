# Executed verification

Local evidence date: 2026-11-04. Counts are separate suites with overlapping scenarios; they must not be added into a fictional independent coverage percentage. Raw reports/toolchains/generated credentials are ignored. Tests use synthetic records and local services. Remote GitHub Actions has not been run.

| Check | Executed result | Evidence boundary |
|---|---|---|
| Backend .NET 10 | 53/53 tests; six hosts build with zero warnings/errors | Domain clocks, PostgreSQL/Testcontainers constraints/migrations, immutability, faults, template versions and replay |
| Gateway | 7/7 real-process tests | Anonymous/signed boundary checks, spoofed headers, query tokens, security headers, readiness |
| Live API | 3/3 | Real Keycloak code/PKCE, eight stages, duplicate receipts, parallel booking prevention, pause authorization, offline evidence, replay/export/warehouse |
| Live resource authorization | 3/3 | Foreign team objects/replay, analyst exclusion, other technician assignments/profiles/time off, booking-first cancellation |
| Live OR-Tools adapter | 1/1 | Actual scoped Scheduling → intelligence HTTP; valid selection/status/runtime, null travel, invalid inputs |
| Web unit/component | 23/23 | Forms/history, authentication utilities, replay, delivery grouping and trace availability |
| Web end-to-end | 10/10, no skips | Authenticated dispatcher/supervisor flows, readonly history/playback, responsive layouts |
| Replay responsive regression | Five Chromium viewport checks | No document overflow at 1512/1280/1024/760/390 pixels with long valid option text |
| Expo mobile | 12/12 plus TS6 typecheck | Queue persistence/restart/backoff/conflicts/isolation and conditional forms |
| Expo compatibility / bundle | Passed | SDK 58 compatibility; clean Android Hermes export, 1,266 modules; not a native-device release test |
| Warehouse | 26/26 PostgreSQL cases | Late/source ordering, cohorts/DST/intervals, deduplication/collision, archive recovery |
| Warehouse quality | Zero defects | Checked-in invariants against the current local warehouse |
| Bootstrap | 5/5 | Existing secrets preserved, additive credentials and SQL/grant policy |
| Runtime database grants | Passed against live containers | Six restricted app identities, audit insert-only, warehouse writer/reader; owners absent from runtime DSNs |
| Intelligence | 18/18 | Chronological dataset/model and independent solver constraints; measured evaluation linked below |
| Observability | Six healthy targets; retained business trace with 11 spans | Includes authorized replay trace-availability check; trace retention is bounded/in-memory |
| Accelerated resilience demo | Passed | Persisted deadline across restart; warning failure/retry; breach/intervention; completed immutable replay; broker-outage recovery |
| Terminal consumer failure | Passed | Notifications retry exhaustion; original message independently found in its RabbitMQ error queue and requeued; separate sanitized immutable Replay diagnostics |
| Live SignalR | Passed | Actual WebSocket through served web → gateway; supervisor notice matches persisted history; analyst/anonymous hub requests denied |

Native Android APK/emulator acceptance is being finalized; see implementation status for latest outcomes. Do not infer native OAuth success from Metro export or code tests.

## Repeat source and service checks

```powershell
dotnet build services/FieldOps.Backend.slnx
dotnet test tests/backend/FieldOps.Tests.csproj --no-build --logger trx --results-directory artifacts/backend
dotnet build gateway/FieldOps.Gateway.csproj
python tests/security/test_gateway.py -v
python scripts/test-local-bootstrap.py -v

# Start Compose before these commands.
python tests/integration/test_live_api.py -v
python tests/backend/verify_resource_authorization_http.py -v
python tests/backend/verify_optimizer_http.py -v
python scripts/verify-database-permissions.py
docker compose run --rm -v "${PWD}:/repo:ro" migrate-warehouse python /repo/tests/warehouse/test_projection.py -v
docker compose run --rm -v "${PWD}:/repo:ro" analytics-worker python /repo/analytics/quality-tests/run_checks.py
```

Gateway tests default to a Debug assembly; set GATEWAY_BUILD_CONFIGURATION=Release for a Release build. Docker is required for PostgreSQL/Testcontainers. This Windows host uses the ignored .tools/dotnet LTS SDK; the system preview SDK was deliberately not used.

```powershell
# In apps/web
npm ci
npm test
npm run build
npx playwright install chromium
$env:WEB_BASE_URL='http://localhost:8088'
$env:FIELDOPS_LIVE_E2E='1'
npm run test:e2e -- --workers=1

# In apps/technician-mobile
npm ci
npm run check
npx expo install --check
npx expo export --platform android --output-dir dist/android
```

Run intelligence tests with its pinned requirements and PYTHONPATH=intelligence; commands and evaluation seeds are in its [README](../../intelligence/README.md). Test artifacts include TRX, Playwright traces/screenshots and ignored JSON resilience/observability reports. A browser capture records the observed page; it does not prove every state or accessibility requirement.

## Security scans and remaining findings

| Scanner / scope | Result |
|---|---|
| Secret guard + Gitleaks 8.28 | No detected leaks in scanned Git history/source |
| Semgrep 1.139, community p/ci + two local rules | Zero findings after pinning actions; 59 applicable rules / 165 targets in that run |
| Trivy 0.67.2 source snapshot | Zero HIGH/CRITICAL vulnerabilities or secrets in the nonignored source snapshot |
| Trivy reporting image | Zero reported vulnerabilities in the scanned runtime image |
| Mobile npm audit | Zero vulnerabilities after Expo 58 upgrade and scoped build-tool overrides |
| ZAP 2.17 pre-login passive baseline | 0 failures, 64 passed checks, 4 warning categories after header hardening |

ZAP remaining categories: non-storable content (intentional no-store policy), CSP style-src unsafe-inline (Fluent runtime style injection), a Unix timestamp pattern in compiled JavaScript (bundle constant), and modern web application informational detection. The scan followed seven public URLs and did not authenticate, exercise APIs or establish ASVS compliance. The -I option leaves informational warnings nonfatal; findings are retained here rather than counted as fixed.

Source scanning excludes generated credentials, installed toolchains, vendor directories and reports. scripts/prepare-security-snapshot.py prepares that scope. A clean source scan does not establish that every monitoring image, environment, dependency behavior or authenticated route is free of vulnerabilities. No load benchmark, production restore drill, full WCAG audit, signed mobile store release or iOS device test is claimed.


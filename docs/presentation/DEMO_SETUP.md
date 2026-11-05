# Demonstration setup and reset

This guide prepares the actual local FieldOps 360 application for the presentation. Use synthetic data and generated development identities. It preserves the normal databases and immutable evidence. The [feature matrix](FEATURE_DEMO_MATRIX.md) defines W1–W6, A1–A3 and E1 demonstration sequences; the [evidence matrix](EVIDENCE_MATRIX.md) distinguishes code, tests, screenshots and observed runtime actions.

## 1. Prerequisites and safe starting point

- Docker Engine with Linux containers and Compose v2+, Python 3.11+ and adequate memory for the local stack.
- For source checks: supported .NET 10 LTS and Node 24. The system .NET 11 preview is not the validated SDK. This host also has an ignored repository-local .tools/dotnet SDK.
- For Android: Java 17, Android SDK/NDK, an x86_64 emulator or compatible physical device, and a rebuilt Expo development client. iOS execution requires macOS/Xcode.
- A copy of the generated root .env that belongs to the retained database volumes. Never print it, interpolate it into slides, or commit it.

Before changing anything:

```powershell
git status --short
git log -1 --oneline
docker compose ps --all
```

Preserve unrelated work. Do not run `docker compose down -v`, Git clean, queue purges, arbitrary SQL deletes or token-storage dumps to make a demonstration appear clean.

## 2. Start or reconcile the local environment

Run from the repository root:

```powershell
python scripts/init-local.py
```

For an existing volume from an earlier implementation, add the non-destructive reconciliation before the full startup. PostgreSQL and Keycloak must be running when their respective reconciliation command runs:

```powershell
docker compose up -d postgres
python scripts/reconcile-database-runtime.py
docker compose up -d keycloak
python scripts/reconcile-local-identity.py
```

Then start the current application and monitoring:

```powershell
docker compose up -d --build
python scripts/wait-local.py
python scripts/verify-database-permissions.py
docker compose --profile monitoring up -d
python scripts/verify-observability.py
```

Expected results: the web, gateway and Keycloak endpoints become ready; seven owner migration jobs exit zero; long-running services use restricted app identities; six Prometheus service targets become healthy. A retained Jaeger trace is required only for the trace demonstration. Jaeger may lose older spans after restart; business evidence remains independently retained.

| Local surface | Address |
|---|---|
| Operations web | http://localhost:8088 |
| API gateway | http://localhost:5100 |
| Keycloak | http://localhost:8080 |
| RabbitMQ management | http://localhost:15672 |
| Jaeger | http://localhost:16686 |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3000 |

Use one consistent localhost issuer. Do not substitute an emulator alias or LAN hostname for only one participant in the OIDC exchange.

## 3. Accounts and recording hygiene

The generated application usernames are `dispatcher`, `technician`, `supervisor`, `manager`, `analyst` and `administrator`. Their development password is stored in the ignored .env as DEMO_PASSWORD. Keycloak's separate administrative login and Grafana use their separately generated credentials.

Use prepared browser contexts for the timed demonstration. Changing context is faster than repeatedly logging out and entering passwords. These are real signed sessions, never a frontend role switch. Keep the credential entry region out of reusable stills. Passwords must remain masked, and tokens, authorization headers, bootstrap secrets and full container environments must never appear in clips, terminal recordings or speaker notes.

The app Administrator role does not automatically authenticate the separate Keycloak administrative console. The Administration screen links that boundary and describes versioned standards; do not improvise unverified identity CRUD during the timed talk.

## 4. Prepare real incident evidence

The repository already seeds technician profiles and uses event-driven projections. Create clearly labeled synthetic work through the application or the existing controlled scenario. Do not alter authoritative timestamps in SQL.

```powershell
docker compose -f docker-compose.yml -f infrastructure/docker/compose.demo.yml up -d --no-deps workflows reporting
python scripts/demo-resilience.py
```

Expected scenario: create/book/start, complete acceptance, recover a later stage's persisted deadline after service restart, record warning failure/retry and breach, acknowledge/intervene, complete the remaining forms, then verify broker-outage outbox recovery. The script restores ordinary workflow/reporting configuration in finally and writes ignored artifacts/demo-resilience.json plus the selected order reference in .local/demo.json.

The override deliberately uses **20/25/30 seconds**. Normal stage thresholds are **20/25/30 minutes**. Existing persisted stage deadlines do not change when environment settings change. Recorded event times and processing latency vary; reproducible behavior does not imply identical elapsed measurements.

For the independent terminal-fault supplement:

```powershell
python scripts/demo-terminal-fault.py
```

Expected result: one original Notifications assistance event reaches its error queue after bounded retry exhaustion, Reporting records separate sanitized failure/dead-letter evidence, and inspected error-queue messages are requeued. The script restores ordinary Notifications settings. Unknown attempt totals remain unknown.

Open the resulting work order in Replay. Confirm the incident has events and retained integrity, and inspect current trace availability. Expired Jaeger spans are a valid explicit outcome, not a reason to fabricate a trace link.

## 5. Validate warehouse-backed views

```powershell
docker compose run --rm --no-deps -v "${PWD}:/repo:ro" analytics-worker python /repo/analytics/quality-tests/run_checks.py
docker compose run --rm -v "${PWD}:/repo:ro" migrate-warehouse python /repo/tests/warehouse/test_projection.py -v
```

Quality returns defectCount=0 for the checked invariants. Current source contains warehouse migrations 001–005, including technician SCD2 and observed time off; older prose describing type-1-only history is stale. The presentation audit confirmed 004/005 in the live migration ledger. Preserve explicit unknown metrics when data or capacity metadata is absent.

Report filters are from/to, technicianId, serviceCategory and priority. Supervisor/stage/SLA filter parameters are not currently implemented in the endpoint signature. Utilization uses appointment overlap and published historical shifts, while outcome metrics use an authorized order-creation cohort. Explain that distinction rather than comparing incompatible denominators.

## 6. Record the web walkthrough

The recording harness uses the actual served UI, real Keycloak login and live APIs. It records each role in a separate context and preserves a manifest of observed actions:

```powershell
node docs/presentation/source/record-web.mjs
```

At preparation time, six raw WebM files and a successful six-role capture manifest exist under demos/web. This is capture evidence; final MP4 encoding/playback validation is tracked separately in [readiness](PRESENTATION_READINESS.md).

For the timed segment, show the dispatcher order and confirmed assignment, then the prepared supervisor incident, analyst metrics/export and Replay. Use supplementary role recordings to account for all six Home pages and the Administration boundary. A navigation-only visit does not demonstrate a mutation, acknowledgment or recovery.

The agent-browser 0.41.2 CLI successfully navigated this local app. Its direct recording command failed because ffmpeg was not on that process PATH; the source harness therefore uses existing Playwright video recording. No global PATH change is required.

## 7. Native Android preparation

This host's presentation emulator is `emulator-5556`. The development APK has been built and installed. The current final Metro session uses local port **8094**, which differs from Expo's usual default 8081. Use the actual chosen port consistently:

```powershell
cd apps/technician-mobile
npm ci
npm run check
npx expo install --check
# Build/install once when the SDK and device are configured:
$env:FIELDOPS_ALLOW_HTTP='true'
npm run android
# Start Metro in a separate terminal:
npx expo start --dev-client --localhost --port 8094
```

Before launching from the host:

```powershell
adb -s emulator-5556 reverse tcp:5100 tcp:5100
adb -s emulator-5556 reverse tcp:8080 tcp:8080
adb -s emulator-5556 reverse tcp:8094 tcp:8094
adb -s emulator-5556 shell am start -a android.intent.action.VIEW -d 'fieldops360://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8094'
```

FIELDOPS_ALLOW_HTTP is a local native build setting; rebuilding is required when it changes. Production must use HTTPS. The custom callback is `fieldops360://oauth/callback`; the app's callback now redirects to the registered tabs route, and the authenticated Stack has a tabs initial route. Earlier unmatched-route footage remains diagnostic material, not a successful functional walkthrough.

Current source checks passed 23 mobile tests plus TypeScript. Root verified SecureStore-backed Home restoration after force-stop/relaunch. The fresh recording of stage submission, assistance, offline synchronization and conflict recovery remains step-specific until the actual action and server result are observed.

On Windows, a bundled Ninja 1.10.2 failed on long native paths. The workspace-local Ninja 1.13.2 retry built successfully; no system registry or global PATH change was required for that fix. Follow the [mobile guide](../../apps/technician-mobile/README.md) and [official Windows build guidance](https://docs.swmansion.com/react-native-reanimated/docs/guides/building-on-windows/) for CMake, Ninja and short-path troubleshooting.

Record actual emulator output with Android screenrecord or an available native capture tool. Split at the tool's duration limit. Pull only the intended MP4, inspect it and record which A1–A3 steps succeeded. Do not substitute a web preview or claim an unobserved offline recovery.

## 8. Media validation and rehearsal

Prefer H.264 MP4 for distribution. The workspace contains an imageio-ffmpeg encoder usable by absolute path; it does not need a global installation. Validate codec, dimensions, duration, nonzero size, decodability and representative frames. A successful transcode alone does not prove the intended feature appears in the clip.

Keep clips silent unless narration was actually recorded. The presenter script supplies spoken commentary. Preserve a local backup of the deck, PDF, script, screenshots and clips; do not depend on a public video service or a remote link during delivery.

The 40-minute plan is an automated allocation, not a human rehearsal. Perform one real rehearsal with the target display and video transitions, then record its observed duration separately.

## 9. Non-destructive reset

1. End presentation browser contexts and log out the native test account when appropriate. Discard only the test draft/queue action you created, using the app's review controls.
2. Restore ordinary new-stage/failure settings if an interrupted demonstration left an override active:

```powershell
docker compose up -d --no-deps workflows reporting notifications
python scripts/wait-local.py
```

3. Cancel a synthetic confirmed booking before canceling its order, and wait for the work-order projection. Do not delete an in-progress/completed workflow or immutable evidence to hide a test outcome.
4. Re-run the scenario to obtain fresh labeled records. Keep older records as observed synthetic history; remove their selection from the current demo rather than rewriting audit data.
5. To stop while retaining data: `docker compose down`. Restart normally for the next session. Never add --volumes to this command for the normal project.
6. Optional clean-first-boot verification uses `python scripts/verify-fresh-compose.py`. That script creates a uniquely named disposable project and removes only its own verified resources; it does not reset the normal environment.

Troubleshooting and operational risk boundaries remain in [local deployment](../operations/LOCAL_DEPLOYMENT.md) and the [operational demonstration guide](../../services/OPERATIONS_DEMONSTRATION.md).


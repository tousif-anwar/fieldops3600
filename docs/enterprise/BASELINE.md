# Enterprise implementation baseline

Recorded 15 November 2026 before enterprise implementation. Source baseline: `1ea2dffb0bc476326faadb9db3832b1f6733ec0e`. Branch: `codex/enterprise-completion`. The original untracked landing implementation was preserved by the parent agent in `stash@{0}` before switching from the older security branch. Do not pop that stash blindly over the current, already-published website source.

## Tooling and commands

`global.json` pins .NET SDK 10.0.403. The system `dotnet` resolves only an 11.0 RC SDK and cannot build this checkout under that pin. The repository-local `.tools/dotnet/dotnet.exe` has SDK 10.0.403 and is the correct local executable. This is a tooling configuration observation, not justification to loosen the project SDK pin.

The sandbox canceled the compiler process during an initial pinned-SDK build. The approved local build ran outside the sandbox with shared compilation disabled:

```powershell
& .tools/dotnet/dotnet.exe build services/FieldOps.Backend.slnx -c Release --no-restore -m:1 -p:UseSharedCompilation=false
```

Result: **passed**, zero warnings, zero errors, 29.37 seconds. All eight service hosts, shared Core/ServiceHost assemblies and backend tests built.

## Backend tests

An initial `Category!=Integration` run produced 87 passed and two environment failures because Docker Desktop was not running. The two failing cases belonged to `ServiceRequestPostgresTests`, which uses the PostgreSQL fixture but lacks the Integration trait. Do not interpret that filtered run as a clean unit baseline or as a new application regression. No test was disabled or relabelled by this audit.

The installed Docker Desktop was started hidden for the authorized database tests. Docker Engine 29.9.2 became available and restarted the existing local Compose containers without deleting or recreating their volumes. The complete backend suite was then run with its default Docker endpoint.

An intermediate attempt manually setting `DOCKER_HOST=npipe:////./pipe/dockerDesktopLinuxEngine` was invalid for Docker.DotNet's URI parser and did not exercise the database cases. That environment override was removed; no source change was made to mask the problem.

```powershell
& .tools/dotnet/dotnet.exe test tests/backend/FieldOps.Tests.csproj --no-build -c Release `
  --logger 'trx;LogFileName=enterprise-baseline-full.trx' `
  --results-directory artifacts/enterprise/baseline
```

Final result: **118 passed, zero failed, zero skipped**, 11 seconds of reported test duration. This includes the real isolated PostgreSQL integration cases. Machine evidence: `artifacts/enterprise/baseline/enterprise-baseline-full.trx`; local console log: `.local/enterprise-baseline-tests.log`. The run used `--no-build` against the already-built pre-enterprise assembly, so implementation edits made concurrently after the baseline build did not enter this result.

## Existing test and CI surfaces

The backend suite uses xUnit and Testcontainers.PostgreSql 4.8.1 with isolated PostgreSQL 18 containers/databases. Existing tests cover migration digests/runtime ACLs, append-only evidence, customer and equipment integrity, booking overlap/execution races, offer rules, workflow forms and SLA, replay and warehouse query definitions. HTTP suites separately exercise customer lifecycle, assignment offers, scheduling races, resource authorization and the optimizer.

The current [validation workflow](../../.github/workflows/validate.yml) builds/tests backend and gateway; runs web build/unit/format/audit; mobile checks/Expo export; optimizer tests/lint; a full Compose integration job including warehouse permissions and browser tests; and security scans. The browser-integrated job is pinned to Ubuntu 24.04. These are configured checks, not evidence that a remote run passed for the new branch.

Web commands from `apps/web`: `npm run lint`, `npm run typecheck`, `npm test`, `npm run format:check`, `npm run build`, and `npm run test:e2e`. React 19.3.1, TypeScript 5.9.3, Vite 7.3.7, Fluent UI 9.75.1, Query 5.90.16 and React Router 7.18.5 are declared in the source manifest. UI routes use lazy imports and existing semantic design tokens. This baseline audit has not run those frontend commands.

Mobile commands from `apps/technician-mobile`: `npm run check` (lint, format, typecheck and Node/tsx mobile tests), `npx expo install --check`, and Android export/build scripts. The manifest declares React Native 0.88.1 and Expo 58.0.23; generated Android directories are ignored and require separate runtime verification. This audit has not rerun native acceptance or certified physical devices/iOS.

## Limits

No fresh business HTTP, browser journey, dependency scan, staging release, backup restore, external provider, Microsoft tenant or legal-signature validation is claimed by this baseline. Existing documentation's historical test totals must not be reported as fresh enterprise results. See [Architecture](ARCHITECTURE.md) for the observed ownership and extension decisions.

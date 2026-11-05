# Contributing

Read the [installation guide](docs/INSTALLATION.md), [architecture overview](docs/architecture/overview.md), and [implementation status](docs/IMPLEMENTATION_STATUS.md) before changing behavior. Keep service data ownership explicit; do not add cross-database queries or weaken backend authorization because the UI already filters a route.

## Workflow

1. Create a focused branch and inspect the existing tests around the behavior.
2. Make the smallest coherent change. Preserve API, event, workflow, SLA, and offline-sync contracts unless the task explicitly changes them.
3. Add or update deterministic tests for workflow transitions, authorization, concurrency, messaging, analytical calculations, or synchronization behavior.
4. Run the affected checks, then the repository checks that cover the change.
5. Review the diff for generated files, secrets, and unrelated churn.
6. Commit with a Conventional Commit message. Do not push, deploy externally, or rewrite published history without authorization.

## Commands

```bash
# Backend
dotnet test tests/backend/FieldOps.Tests.csproj -c Release

# Web
cd apps/web
npm run typecheck
npm test
npm run build
npm run format:check

# Mobile
cd apps/technician-mobile
npm run check

# Intelligence
PYTHONPATH=intelligence python -m pytest -c intelligence/pyproject.toml tests/intelligence -q
python -m ruff check --config intelligence/pyproject.toml intelligence/fieldops_intelligence tests/intelligence

# Documentation
python scripts/check-docs.py
```

The live browser suite is opt-in and creates synthetic data. Start the local stack, then run:

```bash
cd apps/web
FIELDOPS_LIVE_E2E=1 WEB_BASE_URL=http://localhost:8088 npm run test:e2e -- --workers=1
```

## Conventions

- Format C# with `dotnet format`; TypeScript with the component's Prettier command; Python with Ruff.
- Keep business rules out of `Program.cs` and endpoints; put them in the owning domain or application module with a test.
- Use UTC on the server. Never treat client time or a browser/mobile countdown as SLA authority.
- Do not add credentials, generated Keycloak realms, database bootstrap SQL, trained binaries, or local `.env` files to Git.
- Keep screenshots synthetic and current. Add only deliberate evidence under `docs/ui-ux/evidence/`; do not commit emulator scratch captures or duplicate before/after trees.
- Update the authoritative document when behavior or a contract changes. Add a new ADR for a decision that future engineers would otherwise re-litigate.
- Do not weaken or skip a test merely to obtain a green build. If a check cannot run on the host, report the limitation explicitly.

## Pull-request checklist

- [ ] The change is scoped and the behavior is covered by tests.
- [ ] Backend, web, mobile, intelligence, or documentation checks relevant to the change pass.
- [ ] API, event, database, security, and offline contracts were reviewed.
- [ ] New configuration is documented and contains no secret values.
- [ ] Screenshots are current, synthetic, and referenced by a document.
- [ ] Documentation links pass `python scripts/check-docs.py`.
- [ ] Remaining limitations are recorded rather than hidden.

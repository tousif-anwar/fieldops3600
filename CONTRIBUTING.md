# Contributing

Read `docs/IMPLEMENTATION_STATUS.md` before changing the repository. Keep service data ownership explicit and avoid cross-database queries. Include deterministic tests for workflow transitions, authorization, concurrency, messaging or analytical calculations that change behavior. Never use client time as SLA authority.

Format C# using `dotnet format`; TypeScript using the component's scripts; Python using Ruff. Run affected builds and tests, check for secrets, review staged changes, then create a coherent Conventional Commit. Do not commit `.env`, generated identity/database credentials, tokens or trained binary artifacts. Never push, deploy externally or rewrite published history without authorization.

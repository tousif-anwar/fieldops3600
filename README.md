# FieldOps 360

A field service operations platform for dispatch, guided HVAC execution, supervisor intervention, and historical investigation. The requested full specification is implemented in verifiable milestones. See [implementation status](docs/IMPLEMENTATION_STATUS.md) for actual progress and limitations; this README never implies unverified components are complete.

## Repository

- `services/`, `building-blocks/`: six ASP.NET Core service hosts and owned state.
- `gateway/`: YARP ingress with token validation.
- `apps/web/`: React operations, supervisor, analyst and replay interfaces.
- `apps/technician-mobile/`: Expo technician app with durable offline drafts and synchronization.
- `intelligence/`: reproducible synthetic SLA prediction and dispatch optimization.
- `infrastructure/`: identity, database, messaging and monitoring configuration.
- `tests/`: automated validation and reproducible integration scenarios.
- `docs/`: architecture, decisions, security, test evidence and operations instructions.

Start with [architecture](docs/architecture/overview.md) and [implementation status](docs/IMPLEMENTATION_STATUS.md). Local deployment commands will be added and verified with the first integrated milestone.

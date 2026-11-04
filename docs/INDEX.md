# Documentation index

| Topic | Implemented source / guide |
|---|---|
| Current acceptance and resume | [Implementation status](IMPLEMENTATION_STATUS.md) |
| Requirements and constraints | [Requirements](architecture/REQUIREMENTS.md) |
| Context, containers, components | [C4 architecture and ownership](architecture/overview.md) |
| Deployment, service ERD, star schema, event/data flows | [Data and deployment diagrams](diagrams/data-and-deployment.md) |
| All 22 interaction sequences | [Sequence diagrams](diagrams/sequences.md) |
| API and event conventions | [Contracts](architecture/contracts.md), [service guide](../services/README.md), service endpoint source `OperationsApi.cs` / `ReportingApi.cs` |
| Patterns and alternatives | [Design patterns](architecture/patterns.md) |
| Architecture decisions | [Service ownership](adr/001-service-ownership.md), [browser PKCE](adr/002-browser-auth.md), [evidence and runtime grants](adr/003-evidence-and-runtime-grants.md) |
| Security and RBAC | [Threat model / permission matrix](security/threat-model.md), [scan evidence](testing/VERIFICATION.md), [disclosure](../SECURITY.md) |
| State machine, dynamic forms, SLA | [Workflow design](workflows/design.md), versioned JSON under `building-blocks/FieldOps.Core/WorkflowTemplates/` |
| Web and mobile architecture | [Web guide](../apps/web/README.md), [mobile and offline sync guide](../apps/technician-mobile/README.md) |
| Design and accessibility | [Design system](ui-ux/design-system.md), [actual UI walkthrough](UI_WALKTHROUGH.md) |
| Warehouse grain, keys, lineage, quality | [Warehouse guide](../analytics/README.md), [SQL dictionary](../analytics/migrations/001_star_schema.sql), [interval/order corrections](../analytics/migrations/002_ordering_and_interval_capacity.sql) |
| Model features and training | [Intelligence guide](../intelligence/README.md), `intelligence/fieldops_intelligence/prediction.py` |
| Prediction/optimizer results | [Executed evaluation](../intelligence/evaluation/REPORT.md), [machine-readable results](../intelligence/evaluation/results.json) |
| Replay schema, projection, investigation | [Replay model](../replay/event-store/README.md), [demonstration](../services/OPERATIONS_DEMONSTRATION.md) |
| Tests and actual results | [Verification](testing/VERIFICATION.md) |
| Deployment, recovery, troubleshooting | [Local operations](operations/LOCAL_DEPLOYMENT.md) |
| Portfolio narrative and delivery | [Case study / delivery report](case-study/DELIVERY_REPORT.md) |

Documentation describes the checked-in implementation and explicitly distinguishes unexecuted native/deployment checks from evidence. Source SQL and endpoint signatures remain authoritative when a field-level detail is needed.

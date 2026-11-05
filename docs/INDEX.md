# Documentation index

Start with the [repository README](../README.md) for the business and architecture overview. Use [INSTALLATION.md](INSTALLATION.md) for a fresh setup and [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for the current acceptance state.

## Architecture and data

| Topic | Authoritative document |
|---|---|
| Context, containers, components, ownership | [Architecture overview](architecture/overview.md) |
| Requirements and constraints | [Requirements](architecture/REQUIREMENTS.md) |
| API and event conventions | [Contracts](architecture/contracts.md), [service guide](../services/README.md) |
| Design patterns and alternatives | [Patterns](architecture/patterns.md) |
| Deployment, service ERD, star schema, event/data flows | [Data and deployment diagrams](diagrams/data-and-deployment.md) |
| Interaction sequences | [Sequence diagrams](diagrams/sequences.md) |
| Architecture decisions | [Service ownership](adr/001-service-ownership.md), [browser PKCE](adr/002-browser-auth.md), [evidence and runtime grants](adr/003-evidence-and-runtime-grants.md) |
| Warehouse grain, keys, lineage, quality | [Warehouse guide](../analytics/README.md), [star-schema migration](../analytics/migrations/001_star_schema.sql) |
| Prediction and optimizer evaluation | [Intelligence guide](../intelligence/README.md), [measured evaluation](../intelligence/evaluation/REPORT.md) |
| Replay evidence model | [Replay guide](../replay/event-store/README.md), [demonstration](../services/OPERATIONS_DEMONSTRATION.md) |

## Product and operations

| Topic | Authoritative document |
|---|---|
| Local installation, tests, upgrades, troubleshooting | [Installation and local operations](INSTALLATION.md) |
| Deployment, recovery, broker outages, readiness | [Local deployment runbook](operations/LOCAL_DEPLOYMENT.md) |
| Workflow state machine, dynamic forms, SLA | [Workflow design](workflows/design.md) |
| Web portal behavior and auth | [Web guide](../apps/web/README.md) |
| Native app, offline queue, conflicts | [Mobile guide](../apps/technician-mobile/README.md) |
| UI walkthrough with current screenshots | [UI walkthrough](UI_WALKTHROUGH.md) |
| Demo and delivery narrative | [Case study](case-study/DELIVERY_REPORT.md) |
| Feature and acceptance status | [Implementation status](IMPLEMENTATION_STATUS.md) |

## Security and verification

| Topic | Authoritative document |
|---|---|
| Threat model and role matrix | [Security architecture](security/threat-model.md) |
| Secret handling and disclosure | [Security policy](../SECURITY.md) |
| Tests, browser checks, scan scope, evidence boundaries | [Verification record](testing/VERIFICATION.md) |
| Accessibility evidence | [Accessibility report](ui-ux/ACCESSIBILITY_REPORT.md) |
| Usability evidence | [Usability results](ui-ux/USABILITY_RESULTS.md) |

## UI/UX and accessibility

| Topic | Authoritative document |
|---|---|
| Research and sources | [Research](ui-ux/RESEARCH.md) |
| Audit findings | [UX audit](ui-ux/UX_AUDIT.md) |
| Role journeys | [User journeys](ui-ux/USER_JOURNEYS.md) |
| Information architecture | [Information architecture](ui-ux/INFORMATION_ARCHITECTURE.md) |
| Role-based Home | [Role-based Home](ui-ux/ROLE_BASED_HOME.md) |
| Design system | [Design system](ui-ux/DESIGN_SYSTEM.md) |
| UX writing | [UX writing audit](ui-ux/UX_WRITING_AUDIT.md) |
| Accessibility | [Accessibility report](ui-ux/ACCESSIBILITY_REPORT.md) |
| Screenshots and browser evidence | [Evidence directory](ui-ux/evidence/) |

## Engineering

| Topic | Authoritative document |
|---|---|
| Pre-change build, test, and repository baseline | [Refactoring baseline](engineering/REFACTORING_BASELINE.md) |
| File purpose and disposition | [File inventory](engineering/FILE_INVENTORY.md) |
| Removed files, ignores, dependencies, and secrets check | [Repository hygiene](engineering/REPOSITORY_HYGIENE.md) |
| Architecture and code-quality findings | [Code-quality audit](engineering/CODE_QUALITY_AUDIT.md) |
| Measured refactoring and verification results | [Refactoring results](engineering/REFACTORING_RESULTS.md) |
| Documentation moves and preserved sources | [Documentation consolidation](engineering/DOCUMENTATION_CONSOLIDATION.md) |
| Skills used and limitations | [Skill usage](engineering/SKILL_USAGE.md) |

Documentation describes the checked-in implementation and distinguishes local evidence from production claims. Source SQL and endpoint signatures remain authoritative for field-level details.

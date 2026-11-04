# Deployment, data and trust diagrams

```mermaid
flowchart TB
  subgraph Device[Untrusted user devices]
    Browser[React web]
    Phone[Expo app / SecureStore]
  end
  subgraph Local[Loopback exposed local environment]
    Nginx[Nginx web :8088]
    Gateway[YARP :5100]
    Identity[Keycloak :8080]
    Monitor[Grafana :3000 / Prometheus :9090 / Jaeger :16686]
  end
  subgraph Private[Private Compose network]
    APIs[Six .NET 10 services]
    Broker[RabbitMQ]
    Worker[Warehouse worker]
    Python[Advisory inference / OR-Tools]
    Databases[(Separate owned PostgreSQL databases)]
  end
  Browser --> Nginx --> Gateway
  Phone --> Gateway
  Browser & Phone --> Identity
  Gateway --> APIs & Python
  APIs --> Databases & Broker
  Broker --> Worker --> Databases
  APIs --> Monitor
```

```mermaid
erDiagram
  WORK_ORDER ||--o{ OUTBOX_MESSAGE : commits_atomically
  TECHNICIAN ||--o{ TIME_OFF : owns
  BOOKING }o--|| TECHNICIAN_REFERENCE : validates_over_HTTP
  WORKFLOW ||--o{ STAGE_SNAPSHOT : embeds_in_json
  WORKFLOW ||--o{ IDEMPOTENCY_RECEIPT : records_result
  OUTBOX_MESSAGE ||--|| AUDIT_EVENT : logical_identity
  AUDIT_EVENT ||--o{ DELIVERY_ATTEMPT : separates_transport_history
  AUDIT_EVENT }o--|| REPLAY_PROJECTION : rebuilds
  INBOX_MESSAGE ||--|| AUDIT_EVENT : deduplicates
```

The ERD shows logical references across service boundaries, not cross-database foreign keys. Work orders, technicians, scheduling, workflows, notifications and reporting each own separate stores. Service migrations under each service folder are the authoritative physical schemas. Workflows store stage snapshots in one versioned aggregate to make concurrent transition checks atomic.

```mermaid
erDiagram
  DIM_DATE ||--o{ FACT_WORK_ORDER : created_date
  DIM_TECHNICIAN ||--o{ FACT_WORK_ORDER : assignment
  DIM_CUSTOMER ||--o{ FACT_WORK_ORDER : pseudonymous_reference
  DIM_SERVICE_CATEGORY ||--o{ FACT_WORK_ORDER : category
  DIM_WORK_ORDER_STATUS ||--o{ FACT_WORK_ORDER : lifecycle
  FACT_WORK_ORDER ||--o{ FACT_WORKFLOW_STAGE : stage_instances
  DIM_WORKFLOW_STAGE ||--o{ FACT_WORKFLOW_STAGE : definition
  FACT_WORK_ORDER ||--o{ FACT_BOOKING : bookings
  DIM_TECHNICIAN ||--o{ FACT_BOOKING : staff
  FACT_WORK_ORDER ||--o{ FACT_SLA_BREACH : breach_events
  FACT_WORK_ORDER ||--o{ FACT_SUPERVISOR_INTERVENTION : decisions
  DIM_SUPERVISOR ||--o{ FACT_SUPERVISOR_INTERVENTION : actor
```

```mermaid
flowchart LR
  Rules[Authorized service transition] --> Tx[State + outbox transaction]
  Tx --> Dispatch[Locked retrying dispatcher]
  Dispatch --> MQ[MassTransit / RabbitMQ]
  MQ --> Inbox[Reporting inbox]
  Inbox --> Evidence[(Append-only original events + attempts)]
  Evidence --> Replay[Dedicated replay projection]
  Replay --> API[Investigation API]
  API --> Playback[Read-only timeline and playback]
  MQ --> Ledger[Warehouse deduplication ledger]
  Ledger --> Safe[Redacted staging]
  Safe --> Star[(Dimensions and facts)]
  Star --> Reports[Filtered warehouse queries / exports]
  Rules --> OTel[OpenTelemetry trace]
  Evidence -. trace and correlation IDs .-> OTel
```

```mermaid
flowchart LR
  Synthetic[Seeded synthetic snapshots] --> Chronological[Chronological train / calibrate / test]
  Chronological --> Model[Calibrated logistic classifier]
  Chronological --> Evaluation[Rule baseline comparison]
  Model --> Inference[Private inference API]
  Supervisor[Authorized supervisor] --> Inputs[Visible feature assumptions]
  Inputs --> Inference --> Advice[Advisory probability and factors]
  Advice --> Decision[Reasoned accept / dismiss]
  Decision --> Audit[Workflow outbox / replay]
```

```mermaid
flowchart LR
  Dispatch[Dispatcher request] --> Scope[Scoped order / staff / bookings / hours]
  Scope --> Strategy{Strategy}
  Strategy --> Baseline[Qualified staff workload ranking]
  Strategy --> Solver[OR-Tools CP-SAT worker]
  Solver --> Verify[Validate returned assignment]
  Baseline & Verify --> Explanation[Human-readable recommendation]
  Explanation --> Confirm[Dispatcher confirmation / override reason]
  Confirm --> Constraint[PostgreSQL overlap and unique-order constraint]
```

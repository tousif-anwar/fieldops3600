# Implemented interaction sequences

These sequences describe local implementation paths. Cross-service projections are eventual; a response from a source service does not promise every read model has caught up.

## 1. User login
```mermaid
sequenceDiagram
  participant U as User browser
  participant K as Keycloak
  participant G as Gateway
  U->>K: Authorization code request + S256 challenge/state
  K->>U: Login and code redirect
  U->>K: Code + PKCE verifier
  K-->>U: Short-lived signed access token
  U->>G: API call with bearer token
  G->>K: Discovery / signing-key refresh
  G-->>U: Authorized response
```

## 2. Work order creation
```mermaid
sequenceDiagram
  participant D as Dispatcher
  participant W as Work Orders
  participant P as Owned PostgreSQL
  D->>W: POST order + bearer token
  W->>W: Validate role/team and input
  W->>P: Commit order + WorkOrderCreated outbox
  W-->>D: 201 with authoritative order
```

## 3. Technician scheduling
```mermaid
sequenceDiagram
  participant D as Dispatcher
  participant S as Scheduling
  participant T as Technician service
  participant P as Scheduling PostgreSQL
  D->>S: Request recommendations
  S->>T: Scoped profiles, hours and time off
  S->>P: Confirmed bookings for relevant interval
  S-->>D: Feasible staff and contributing factors
  D->>S: Confirm appointment
  S->>P: Commit booking + outbox after revalidation
```

## 4. Booking conflict prevention
```mermaid
sequenceDiagram
  participant A as Dispatcher A
  participant B as Dispatcher B
  participant S as Scheduling
  participant P as PostgreSQL
  A->>S: Create confirmed interval
  B->>S: Concurrent overlapping interval
  S->>P: INSERT A
  S->>P: INSERT B
  P-->>S: One commit; one exclusion violation
  S-->>A: 201
  S-->>B: 409 conflict
```

## 5. Workflow initiation
```mermaid
sequenceDiagram
  participant T as Technician
  participant F as Workflows
  participant S as Scheduling
  participant P as Workflow PostgreSQL
  T->>F: Start assigned order
  F->>S: Validate confirmed assigned booking
  F->>P: Store versioned instance, first deadline and outbox
  F-->>T: Stage zero with server timestamps
```

## 6. Form submission
```mermaid
sequenceDiagram
  participant T as Technician
  participant F as Workflows
  participant P as PostgreSQL
  T->>F: Expected version + idempotency key + answers
  F->>P: Check receipt / aggregate version
  F->>F: Validate visible options and stage order
  F->>P: Atomic transition + receipt + outbox
  F-->>T: Next stage or original receipt on duplicate
```

## 7. SLA warning
```mermaid
sequenceDiagram
  participant Q as Quartz sweep
  participant F as Workflow rules
  participant P as PostgreSQL
  participant N as Notifications
  Q->>P: Read durable active stages
  Q->>F: Evaluate server UTC at 20-minute threshold
  F->>P: Commit warning level + event outbox
  P-->>N: Outbox dispatcher / broker delivery
  N-->>N: Persist technician warning once
```

## 8. SLA breach
```mermaid
sequenceDiagram
  participant Q as Quartz sweep
  participant P as Workflow PostgreSQL
  participant B as RabbitMQ
  participant N as Notifications
  Q->>P: Persist breached level at 30 effective minutes
  P->>B: Durable outbox StageSLABreached
  B->>N: At-least-once delivery
  N->>N: Inbox deduplication and supervisor alert
```

## 9. Supervisor notification
```mermaid
sequenceDiagram
  participant B as RabbitMQ
  participant N as Notifications
  participant P as Notification PostgreSQL
  participant U as Supervisor browser
  B->>N: Warning/breach/assistance event
  N->>P: Inbox + notification transaction
  N-->>U: SignalR team group notification
  U->>N: Reconcile history after reconnect
```

## 10. Supervisor pause approval
```mermaid
sequenceDiagram
  participant S as Supervisor
  participant F as Workflows
  participant P as PostgreSQL
  S->>F: Pause with expected version and reason
  F->>F: Role/team check and outstanding SLA evaluation
  F->>P: Commit paused timestamp and audit outbox
  S->>F: Resume with reason
  F->>P: Add approved pause seconds to deadline
```

## 11. Workflow completion
```mermaid
sequenceDiagram
  participant T as Technician
  participant F as Workflows
  participant B as RabbitMQ
  participant W as Work Orders
  T->>F: Valid final-stage form
  F->>F: Complete aggregate and outbox atomically
  F->>B: WorkflowCompleted
  B->>W: Idempotent lifecycle projection
  W->>W: Completed state + WorkOrderCompleted outbox
```

## 12. Mobile offline synchronization
```mermaid
sequenceDiagram
  participant T as Technician
  participant M as Mobile queue
  participant F as Workflows
  T->>M: Save answers while offline
  M->>M: Persist stable key/version/client time under owner namespace
  M->>F: Reconnect; submit same logical operation
  alt Version still current
    F-->>M: Committed receipt and server response time
  else Concurrent supervisor or stage change
    F-->>M: 409; preserve conflict for human review
  end
```

## 13. Warehouse ingestion
```mermaid
sequenceDiagram
  participant B as RabbitMQ
  participant I as Analytical worker
  participant P as Warehouse PostgreSQL
  B->>I: Original MassTransit event envelope
  I->>P: Check event ID and canonical hash
  I->>P: Commit ledger, redacted staging, dimensions and facts
  I-->>B: Acknowledge after commit
```

## 14. Analytics report generation
```mermaid
sequenceDiagram
  participant A as Analyst
  participant R as Reporting
  participant W as Warehouse
  A->>R: UTC range and supported filters
  R->>R: Report policy and team scope
  R->>W: Parameterized cohort/fact queries
  W-->>R: KPIs, charts and freshness
  R-->>A: JSON or escaped CSV/PDF
```

## 15. Unauthorized access
```mermaid
sequenceDiagram
  participant U as Caller
  participant G as Gateway
  participant S as Owning service
  U->>G: Forged identity headers without valid token
  G-->>U: 401
  U->>G: Valid technician token for unassigned object
  G->>S: Forward signed token
  S-->>U: 404 hidden resource
```

## 16. Message retry and recovery
```mermaid
sequenceDiagram
  participant B as RabbitMQ
  participant R as Reporting consumer
  participant P as Reporting PostgreSQL
  B->>R: Business event
  R->>P: Append controlled failed delivery attempt
  R-->>B: Processing failure
  B->>R: Retry same event identity
  R->>P: Append successful attempt, inbox, evidence and projection
  R-->>B: Acknowledge
```

## 17. Predictive SLA inference
```mermaid
sequenceDiagram
  participant S as Supervisor
  participant G as Gateway
  participant M as Intelligence
  participant F as Workflows
  S->>G: Visible non-identifying feature values
  G->>M: Authorized private inference
  M-->>S: Synthetic calibrated probability, factors, model and limitation
  S->>F: Accept/dismiss with provenance and reason
  F->>F: Audited advisory decision; no automatic operational mutation
```

## 18. Optimization recommendation
```mermaid
sequenceDiagram
  participant D as Dispatcher
  participant S as Scheduling
  participant O as OR-Tools worker
  D->>S: Scoped order + fixed appointment + optimized strategy
  S->>S: Load and validate actual profiles/time off/bookings
  S->>O: Feasible minute windows and workload
  O-->>S: Assignment, solver status and measured runtime
  S->>S: Independently validate returned staff/job/interval
  S-->>D: Explainable recommendation, no reservation
```

## 19. Replay ingestion
```mermaid
sequenceDiagram
  participant B as RabbitMQ
  participant R as Replay consumer
  participant P as Reporting PostgreSQL
  B->>R: Source event and causal metadata
  R->>P: Atomic inbox + original text/hash + delivery attempt
  R->>P: Update dedicated replay projection
  R-->>B: Acknowledge after commit
```

## 20. Incident reconstruction
```mermaid
sequenceDiagram
  participant S as Supervisor
  participant R as Investigation API
  participant P as Replay evidence
  S->>R: Authorized work-order investigation
  R->>P: Read team-scoped immutable events and attempts
  R->>R: Order by causation/source sequence; flag uncertainty
  R-->>S: Timeline, historical state and factual incident summary
  S->>S: Move playback cursor without issuing commands
```

## 21. Late event handling
```mermaid
sequenceDiagram
  participant B as Broker
  participant R as Replay consumer
  participant P as Evidence store
  B->>R: Late event with original occurrence timestamp
  R->>P: Append original event plus new receipt/processing timestamps
  R->>R: Rebuild order from causation and source sequence
  R-->>R: Preserve evidence, expose delay and missing-parent uncertainty
```

## 22. Trace correlation
```mermaid
sequenceDiagram
  participant U as Authorized investigator
  participant R as Replay UI
  participant J as Jaeger
  U->>R: Expand technical event details
  R->>J: Check trace identifier availability
  alt Trace retained
    R-->>U: Link to the specific trace
  else Expired or tracing unavailable
    R-->>U: Retain ID and show unavailable/retention message
  end
```

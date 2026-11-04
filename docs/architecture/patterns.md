# Patterns and tradeoffs in the implementation

| Problem | Pattern and location | Reason and benefit | Tradeoff / alternative |
|---|---|---|---|
| Service resource isolation | DI, `ServiceDb` role-specific EF model, `Caller` policy | Thin independently deployable hosts with explicitly owned tables | Shared host infrastructure couples upgrades; separate host libraries would reduce coupling at more duplication |
| Ordered technician execution | State machine, `WorkflowEngine` | One authoritative ordered stage, expected-version transitions, pure clock-driven rules | Current default template is code-versioned; runtime template authoring is pending |
| Different dispatch objectives | Strategy, baseline API and Python `scheduling.py` | Rule ranking can be compared with OR-Tools on identical inputs | CP-SAT has a bounded runtime and may return only a feasible solution |
| Business changes with reliable notification | Transactional outbox, `ServiceDb.Enqueue` and `OutboxDispatcher` | State and event are committed in one PostgreSQL transaction; publishes retry after restart | At-least-once delivery needs deduplication; direct synchronous publication would lose events on failure |
| Duplicate event delivery | Inbox, `OperationalConsumer`; warehouse event ledger | One logical action and one fact per event identity | Delivery attempts remain separate evidence; retention must keep deduplication records long enough |
| Replay without querying every service | CQRS read model, reporting event store and replay projection | Investigation is read-only and decoupled from operational database availability | Projection is eventually consistent; missing evidence and ordering uncertainty must stay visible |
| Browser / mobile identity | OIDC adapter, Keycloak public PKCE clients | Standards-based login without application password handling | In-memory web tokens require reauthentication on hard reload; a BFF could persist a secure server session |
| Device disconnection | Durable queue, `src/offline/queue.ts` | Stable idempotency and explicit version conflicts survive restarts | One pending stage can advance only after server acceptance; background execution is not guaranteed by mobile OSs |
| Reporting from business events | Dimensional projection, `analytics/ingestion-worker` | Warehouse owns star facts and redacted dimensions independent of operations | Type-1 dimension corrections and limited capacity history; SCD2 is a future improvement |
| Configuration and failure handling | Options and Problem Details | Thresholds validate at startup; known business conflicts map to 400/404/409 | No broad repository/factory abstraction was added where EF already supplies unit-of-work behavior |

The code follows pragmatic service/domain separation rather than adding interfaces for every class. Stateless rules accept explicit dependencies and timestamps, while HTTP endpoints own authentication and persistence coordination.

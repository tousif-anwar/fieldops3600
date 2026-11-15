# Inventory integration safeguards

Recorded 15 November 2026 during the inventory vertical slice. This report covers reporting/warehouse isolation, gateway readiness/authentication, and configured CI hooks. Inventory command rules, business HTTP journeys, client UI and real RabbitMQ end-to-end evidence are separate gates; this report does not mark the whole capability complete.

## Implemented behavior

- [Reporting consumer](../../building-blocks/FieldOps.ServiceHost/Messaging.cs): Inventory events retain their original serialized audit body and related work-order replay history. They do not create work-order/stage analytical facts, invent technician assignment, advance job state, or change an observed job's analytical freshness. Events with no order remain audit evidence without an empty-order replay projection. Existing consumer inbox/event identity deduplication remains authoritative.
- [Warehouse worker](../../analytics/ingestion-worker/worker.py): Inventory source events retain deduplicated ingestion ledger and sanitized staging evidence. They stop before technician/order/stage fact projection. They do not silently become workload or service-performance observations. Inventory costing will need its own intentional commercial projection/consumer rather than overloading work-order metrics.
- [Gateway](../../gateway/Program.cs): Routing and readiness now share one set of resolved business-service addresses. This includes Inventory and its standalone default port 5109. It also removes the previous readiness-only fallback ordering, which differed from route ordering. Any required host failure keeps readiness unhealthy while liveness continues to report that the gateway process is running.
- [CI](../../.github/workflows/validate.yml): Web lint now runs alongside existing build/test/format/audit checks. The integrated Compose job runs `tests/backend/verify_inventory_http.py` after existing HTTP authorization/optimizer checks. The command is a required business-flow gate, not a replacement for existing tests.

Future non-order commercial/integration source events need the same intentional analytical boundary. This pass explicitly handles the implemented Inventory owner; it does not define facts for later contexts.

## Exact verification

| Command / environment | Result |
|---|---|
| `.tools/dotnet/dotnet.exe build gateway/FieldOps.Gateway.csproj -c Release --no-restore -m:1 -p:UseSharedCompilation=false` | Passed, zero warnings/errors, 2.93 seconds |
| `GATEWAY_BUILD_CONFIGURATION=Release python tests/security/test_gateway.py -v` | 10/10 passed, 7.476 seconds |
| `.tools/dotnet/dotnet.exe build tests/backend/FieldOps.Tests.csproj -c Release --no-restore -m:1 -p:UseSharedCompilation=false` | Passed, zero warnings/errors, 6.12 seconds |
| `.tools/dotnet/dotnet.exe test tests/backend/FieldOps.Tests.csproj --no-build -c Release --filter FullyQualifiedName~InventoryReportingTests --logger trx --results-directory artifacts/enterprise/inventory` | 3/3 passed, two seconds reported test duration |
| `python -m unittest discover -s tests/warehouse -v`, with existing local warehouse credentials supplied only through the process environment | 44/44 passed, 2.044 seconds |
| Python compilation for changed gateway/warehouse tests and worker; `git diff --check` | Passed |

On this Windows host the pinned SDK must be invoked from `.tools/dotnet`; see the [baseline tooling record](BASELINE.md). Backend compiler/test and loopback service processes required the approved execution context. No credentials are recorded in these reports or console excerpts.

The [new reporting tests](../../tests/backend/InventoryReportingTests.cs) drive the actual `OperationalConsumer` through MassTransit's in-memory transport and a real isolated PostgreSQL database with service SQL migrations. They cover a duplicated related consumption event, an unrelated receipt, and inventory activity after an observed work-order creation. **The broker transport is simulated in these tests; PostgreSQL and consumer persistence are real.** RabbitMQ delivery is not claimed by these three tests.

The [gateway tests](../../tests/security/test_gateway.py) launch the real gateway process with ordinary JWT authentication. The two fixture modes check absent/invalid authentication and controlled upstream health responses. They verify that eight healthy services cannot hide an unhealthy Inventory host; inventory paths reject missing credentials and spoofed identity headers. They do not bypass authorization or modify production authentication.

The [warehouse cases](../../tests/warehouse/test_projection.py) execute against real PostgreSQL and roll back test rows. New cases assert retained/deduplicated Inventory evidence with no fabricated job, technician or workflow-stage fact, and no change to an existing job's assignment or occurrence freshness. The rest of the warehouse regression suite also passed. The temporary local runner only reads ignored local secrets and sets a child process environment; it does not print or store their values.

Machine evidence: `artifacts/enterprise/inventory/inventory-reporting.trx`; local logs `.local/enterprise-inventory-reporting-tests.log`, `.local/enterprise-reporting-build.log`, `.local/enterprise-warehouse-tests.log`, `.local/gateway-security.log`, and `.local/gateway-inventory-readiness.log`. These paths are ignored operational evidence, not committed credentials or proof of a remote CI run.

## Remaining gates

The root implementation still needs to finish/run the new business HTTP script, rebuild the Inventory service and dependent runtime images, exercise outbox delivery through real RabbitMQ, verify web/mobile journeys and append-only Inventory ACLs, and run the final consolidated regression/CI checks. Configuring a CI step is not evidence that GitHub Actions has executed it. No provider delivery, financial/legal approval, staging deployment or production certification is claimed here.

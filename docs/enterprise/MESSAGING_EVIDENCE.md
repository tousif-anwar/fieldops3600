# Local enterprise event delivery

Verified 16 November 2026, America/New_York, against the running local Compose RabbitMQ broker and isolated PostgreSQL runtime identities.

After the synthetic inventory and maintenance browser/API workflows, run:

```powershell
python scripts/verify-enterprise-delivery.py
```

The read-only verifier selects the latest twenty owner outbox events created within the previous twenty-four hours from each of `inventory` and `customers`. It waits at most thirty seconds for their publication markers and then matches their event IDs to reporting's unique audit records and transactional inbox entries. It neither injects broker messages nor replays database records. No credentials or event bodies are printed.

Observed result: inventory **20 published / 20 audited / 20 inbox**; customers **20 / 20 / 20**. Inventory types include stock movements, parts consumption/return, catalog creation and parts requests. Customer types include agreement creation/status, recurring plans/visits, dispatch intent/work-order linkage, and renewal/draft creation.

This establishes local owner-outbox → RabbitMQ → reporting delivery and retention for these sampled events. It does not establish delivery to an external notification provider, a Microsoft tenant, a production environment, or the native mobile runtime. The maintenance completion consumer has separate domain/PostgreSQL/live workflow evidence; this reporting check alone does not prove entitlement usage.

CI runs the verifier after the live inventory and contract HTTP workflows. Each run must produce recent synthetic events; an empty source fails rather than claiming success from no work.

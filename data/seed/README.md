# Reproducible Demo Data

The project does not ship a database dump. Demonstration records are created through the running application's authenticated APIs so the same validation, versioning, outbox, and authorization paths used by real requests are exercised.

## Prerequisites

- The Compose stack is running and `server/.env` exists.
- The demo accounts are available.
- Read the shared password locally from `server/.env`; never copy it into this document or a slide.

## Commands

From `server/`:

```bash
python scripts/seed-demo-data.py
python scripts/seed-enterprise-history.py
```

The scripts use `scripts/local-auth.py` to obtain real Keycloak tokens. They print the synthetic records they create and write a local manifest under `.local/`, which is ignored and excluded from the release.

`seed-enterprise-history.py` supports a finalization pass:

```bash
python scripts/seed-enterprise-history.py --finalize-only
```

Use that only to complete previously created synthetic workflows; do not use it as a substitute for fixing a failed workflow.

## Demonstration scenarios

A reliable presentation can create one new request rather than relying on pre-existing rows:

1. Dispatcher creates a synthetic HVAC request for a north-team customer/location.
2. Dispatcher requests a baseline recommendation and then an optimized recommendation.
3. Dispatcher confirms a future weekday booking.
4. Technician opens the assigned job and submits the eight stages.
5. Supervisor reviews the stage history, pauses/resumes with a reason, and opens Replay.
6. Analyst reviews warehouse metrics and exports an order report.

Use unique titles and future dates. Avoid hand-editing database rows to make a metric appear; if the warehouse is empty, wait for the ingestion worker or explain that the population is empty.

## Data exclusions

The release excludes:

- `.env` and generated credentials;
- Keycloak realm imports and PostgreSQL init SQL;
- PostgreSQL/RabbitMQ volumes;
- `artifacts/`, `.local/`, and generated evidence files;
- live customer data and private keys.

The synthetic records created locally are not part of the archive.

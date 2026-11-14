# Presentation Guide

## Before the demonstration

1. Start from the extracted release:

   ```bash
   cd server
   python scripts/init-local.py
   docker compose up -d --build
   python scripts/wait-local.py
   ```

2. Confirm <http://localhost:8088> loads and <http://localhost:5100/health/ready> returns 200.
3. Confirm the demo users exist and read the password locally from `server/.env`. Do not put it on a slide.
4. Seed or verify the synthetic demonstration data. Do not edit database rows to make a screen look populated.
5. Keep a second terminal open for service logs if a live failure occurs.
6. Decide whether to use the normal SLA thresholds or the explicit accelerated demo override. Use the override only when demonstrating breach timing; it is not a production setting.

The archive does not include a live database volume. Each demonstration environment generates or seeds its own synthetic records.

## Suggested sequence

### 1. Introduce the problem (1 minute)

Explain the four operational questions: who is qualified, is the procedure being followed, what needs attention now, and what evidence remains afterward. State the scope honestly: this is a local engineering demonstration, not a production SaaS.

### 2. Show the architecture (2 minutes)

Use the diagram in [System architecture](SYSTEM_ARCHITECTURE.md). Highlight:

- service-owned PostgreSQL databases;
- the gateway and per-service token validation;
- transactional outbox/inbox messaging;
- the private deterministic optimizer;
- separate operational and warehouse reads;
- immutable replay evidence.

### 3. Dispatcher creates a request (2 minutes)

Sign in as `dispatcher`.

1. Open **Work orders** and create a synthetic service request.
2. Select a registered customer/location, or show the explicit unregistered-customer reason.
3. Open the request and choose a future appointment window.
4. Run **Baseline** first, then **OR-Tools optimization**.
5. Explain that recommendations do not reserve capacity; confirm the booking.
6. Show the assignment on the scheduling board and the retained notification.

If a candidate is unavailable, use that as an honest explanation of qualification/hours/conflict rules rather than forcing a booking.

### 4. Show dispatcher conflict protection (1 minute)

Attempt a second confirmed booking for the same work order or a competing technician slot. Show the `409` conflict and explain the transaction plus partial unique index. Do not imply that the UI alone prevents the duplicate.

### 5. Technician receives and executes work (3 minutes)

Sign in as `technician` in a second browser profile or device.

1. Show the assigned job on Home/My work.
2. Open the workflow and point out the server-defined stage timer and form.
3. Complete a stage and show the read-only history.
4. Optionally request supervisor assistance.
5. Explain the offline draft/queue behavior in the Expo app and the conflict-aware sync tests. If no emulator is available, say so; do not claim a device run.

### 6. Supervisor monitors and intervenes (2 minutes)

Sign in as `supervisor`.

1. Show the at-risk/overdue view.
2. Pause and resume the stage with a reason.
3. Point out that the evidence retains the pause and the earlier breach.
4. Show the notification history and live hub delivery.

### 7. Show SLA behavior (1–2 minutes)

With the normal configuration, explain the 20/25/30-minute thresholds. If using the accelerated demo, show the warning/critical/breach transitions and then restore normal configuration. Make clear which mode is active.

### 8. Show Operational Replay (2 minutes)

Open Replay for the demonstrated work order. Point out:

- event order and causation;
- delivery attempts and retries;
- integrity verification;
- reconstructed state;
- CSV/PDF export;
- trace availability.

Replay is read-only; the only mutation is the Administrator projection rebuild.

### 9. Show analytics (2 minutes)

Sign in as `analyst` or `supervisor`. Show completion, SLA, stage duration, escalation, category, and utilization metrics. Point out the report scope, definitions, data source, freshness, and blank/null behavior for empty populations. Explain that the warehouse is eventually consistent.

Do not sign in as `dispatcher` for analytics; that role intentionally lacks the navigation item and API access.

### 10. Show persistence and recovery (1 minute)

Describe the live validation: restarting the workflow service preserved the deadline, the warning was retried, a breach was recorded, supervisor actions survived, and a broker outage was recovered by the outbox. The release verification report records the actual result.

### 11. Close with boundaries (1 minute)

State clearly:

- customer self-service login/booking is not implemented;
- contract entitlement and installation permitting are partial;
- the Expo app was typechecked and unit-tested but not run on a native emulator in this release;
- the local stack is not production-certified;
- no generative AI is part of the release.

## Reliable demonstration tips

- Use a fresh browser profile for each role to avoid mixing Keycloak sessions.
- Prefer client-side navigation after sign-in; hard reloads repeatedly bootstrap OIDC and can be slower.
- Choose future dates inside technician working hours and away from existing bookings.
- Use unique synthetic titles so search results and replay are easy to identify.
- If a warehouse tile is empty, wait for the ingestion worker and refresh; do not invent a value.
- If a 401 occurs, sign in again. If a 403 occurs, check the role; do not bypass policy.
- Keep the password out of slides, terminal scrollback, and screenshots.
- Have [Known limitations](README.md#known-limitations) ready for questions.

## What not to claim

- A customer portal demonstration.
- Native Android execution or physical-device certification.
- Production deployment, high availability, or compliance certification.
- Real-world predictive accuracy (there is no predictive model in the release).
- A remote CI run or cloud deployment for this release.
- That the UI alone enforces authorization or conflict protection.

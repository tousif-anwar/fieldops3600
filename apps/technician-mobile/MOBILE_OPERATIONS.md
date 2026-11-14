# Technician operations

The Home, Daily itinerary, assignment-offer details, job execution, Sync, and
Account screens use the existing gateway APIs and authenticated technician scope.
The app does not create appointment availability or calculate compensation.

## Daily work and directions

Home shows confirmed appointments for the device-local calendar day, completed
stops from work-order/workflow evidence, pending local operations, the current
service stage, and the next destination. The itinerary retains dispatch's
appointment order; navigation never changes a booking. It distinguishes current,
completed, next, and passed appointment windows. A passed window is a scheduling
notice, separate from the server's stage SLA.

Directions use the documented [Google Maps universal directions URL](https://developers.google.com/maps/documentation/urls/get-started#directions-action).
On an explicit tap the destination opens in Google Maps or a browser. There is no
API key, traffic estimate, background geolocation, or location-history collection.
The service address remains selectable when navigation is unavailable. Routing
availability and offline maps depend on the user's navigation app.

Shift check-in, authorized overtime, on-call duty, and time-off approval require
additional server workflows. Appointment counts and booked minutes are not shift
attendance or hours worked.

## Assignment offers

- `GET /api/assignment-offers` loads the authenticated technician's offers.
- Only pending, unexpired offers appear as new offers on Home.
- Offer details show the appointment, destination, priority, and response deadline.
- Acceptance and decline require an active connection and explicit confirmation.
- Decline requires a reason containing 3–500 characters.
- Responses send the observed version and a generated operation ID. A retry on
  the same screen retains the original version, response, reason, and operation
  ID; it does not invent a second logical command.
- A failed or ambiguous response refreshes the authoritative offer. Accepted
  responses refresh the work-order and booking queries before opening service.
- The client clock controls display only. The server checks expiration,
  qualifications, working hours, conflicts, exclusivity, and idempotency.
- Offer responses do not enter the offline stage queue. Offer data is not
  persisted in the long-lived query cache.

## Guided service and offline evidence

Stage controls follow their versioned server template. Choice, free-text, and
bounded decimal fields support diagnosis, service notes, labor minutes, parts
descriptions, and recommendations. Visible required fields, configured lengths,
and ranges are checked before queueing; the server validates again. Hidden
conditional values are removed and text is trimmed before the immutable command
is queued.

Existing per-account AsyncStorage queues retain a stable operation ID, workflow
version, stage, answers, and client timestamp. Only an authoritative server
receipt advances the workflow. A version conflict preserves the answers for
review; it never silently rebases a command. New workflow creation, assignment
acceptance, approvals, and authoritative inventory decisions remain online.

The Account activity view is computed from actual completed/overridden stages and
recorded workflow completion timestamps. History is bounded by the backend's
latest 500 authorized workflows. It is not payroll or an employment score.

## Verification

```powershell
cd apps/technician-mobile
npm run check
```

The native offline check requires the local Docker stack, the Android development
build, Metro on port 8081, and a technician signed in through the real Keycloak
flow. It uses a labeled synthetic API fixture and restores emulator networking in
cleanup. Run from the repository root:

```powershell
python apps/technician-mobile/scripts/verify-android-offline.py --serial emulator-5556
```

This check disables Android connectivity, submits a cached stage, confirms the
server did not advance, force-stops and relaunches the app, verifies the durable
queue, and reconnects to confirm synchronization. A successful run writes
`.local/mobile-android-offline-verification.json`. Normal SLA timings are required;
accelerated SLA milestones can intentionally introduce a version conflict.

Typechecking and deterministic tests alone do not establish native offline
reliability. A successful emulator run also does not certify physical-device or
iOS behavior, camera attachments, background execution, or production deployment.

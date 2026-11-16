# Maintenance plan amendments

Updated 16 November 2026, America/New_York. This module changes future recurrence in the existing customer context. It adds no service, table, migration, booking authority or financial authorization rule.

## Command

`PUT /api/contracts/{contractId}/plans/{planId}` requires the existing `supervise` policy and resource authorization for the agreement's team. The request is:

```json
{
  "operationId": "a new UUID for this command",
  "expectedContractVersion": 7,
  "expectedPlanVersion": 2,
  "frequency": "Quarterly",
  "firstNewDue": "2027-07-31",
  "endsOn": "2027-12-31",
  "serviceLocationId": "an active customer-owned site UUID",
  "reason": "Customer agreed a quarterly maintenance window"
}
```

`endsOn` may be null. Cadence uses the existing Monthly, Quarterly, Semiannual and Annual values. The response contains `contractId`, the incremented `contractVersion`, and `plan` using the existing `MaintenancePlanView` contract, including its incremented version, next due date and service location.

The agreement must be Draft, Active or Suspended, and its customer and coverage line must remain active. Cancelled and Expired agreements reject new amendments. The command explicitly starts a new active recurrence window, so an ended plan can be restarted when the agreement, dates and line remain eligible. It rejects an attempt to restart an old plan if another active plan already owns the same line/equipment recurrence. Plan identity, coverage line and equipment references cannot be changed by this command.

## Calendar and existing work

The first new due date must be on or after both today and the effective start in the **agreement's time zone**, and strictly after the latest previously generated visit date for that agreement, coverage line and equipment. This includes Pending, Scheduled, Completed, Missed and Cancelled history. A canceled future visit therefore does not allow rewriting the same date under a new cadence.

An explicit end cannot precede the first new due date. Both the first due date and any explicit end must fit within the agreement's exclusive expiration. An expiration exactly at local midnight excludes that day; a partial last local day remains available as a calendar due date. Precise entitlement authorization at dispatch/completion remains separate.

The requested first day becomes the new month anchor. For example, a new monthly window beginning January 31 advances through February 28/29 and then March 31. Existing generated visits keep their dates, site references, statuses, work-order links, assignment revisions and completion evidence. The normal generator later creates only new dates from the amended cursor. The command itself does not generate visits, create jobs, reschedule appointments or alter technician assignments.

## Authority and reliability

An explicit active customer-owned site is required. For equipment-specific plans, the assets owner must confirm the equipment is active, belongs to the same customer/team, and is currently at that site. This remote read occurs before the customer database lock; the site is rechecked inside the transaction. Owner validation is a point-in-time reference check, not a distributed lock. Normal dispatch validates the source again before creating work.

The command takes the existing team `:contracts` advisory lock and reloads the agreement and plan before comparing both expected versions. Mutating recurrence, incrementing versions, writing actor/reason/correlation evidence, adding the transactional outbox message, and recording the actor-scoped request-hash receipt commit together. The `MaintenancePlanAmended.v1` audit/outbox details contain full before/after plan fields, including anchor, cursor, end, active flag and version.

Identical retries return the original response even after later generation, closure or a remote owner outage, after rechecking current agreement access. Reusing that operation ID with a different command returns 409. A different concurrent command using stale versions also returns 409. Authorization and invalid resource/date failures leave no receipt, plan change or amendment event.

## Verification

The new real PostgreSQL tests are [ContractPlanApiTests.cs](../../tests/backend/ContractPlanApiTests.cs). They cover duplicate-command races, competing commands with the same versions, replay after generation/closure, unchanged historical work, new-cadence generation, stale versions, closed states, explicit restart, all-status visit history, New York local/DST and exclusive-midnight boundaries, future Draft dates, team/customer/site isolation, active equipment/current site validation and an owner callback proving the team lock is not held across HTTP. The callback archives the site before returning so the transaction must reject the now-inactive reference.

These tests are pending execution until the shared .NET window is released. No passing count or live HTTP/browser result is claimed here yet. The parent integration owns route registration, the operator UI and live acceptance.

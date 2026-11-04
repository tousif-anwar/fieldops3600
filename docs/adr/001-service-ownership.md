# ADR 001: Six business services with shared infrastructure code

Status: accepted, 2026-11-04.

The target organization has 25 technicians. Six business boundaries are required, but extracting a separate deployment for every background worker would add operating cost without demonstrated load. Each business service is independently deployable with an owned database and thin host. Shared infrastructure implements token validation, event envelopes, clock abstractions and transport behavior. Reporting hosts analytical and replay consumers as independently testable components.

Shared code does not grant a service permission to read another service's database. Critical business state and its outbox use one database transaction. Cross-service projections are eventually consistent, so dispatch UI must account for temporary unavailability after booking.

Tradeoff: shared host code can couple deployment upgrades; resource boundaries need tests. Alternatives were a modular monolith (simpler, contrary to the specified deployable boundaries) and more workers (unjustified for present volume).

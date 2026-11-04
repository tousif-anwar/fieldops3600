# ADR 003: preserve original evidence and separate migration identities

Status: implemented.

Replay must explain late and failed delivery without turning a retry into a second business action. Store the original serialized envelope and SHA256 alongside independent append-only delivery observations. Rebuild a dedicated mutable projection from those originals. Order by causation and source-local sequences where available; label uncertainty instead of trusting a total device-time order.

Each operational service uses its own restricted runtime PostgreSQL role. One-shot migration jobs retain schema-owner credentials, apply migrations and grants, then exit. Ordinary tables permit necessary DML; replay event/attempt tables permit SELECT/INSERT only and have immutable triggers. The warehouse writer cannot perform DDL; Reporting's warehouse role is read only. Live permission tests assert these boundaries.

A single owner connection would simplify startup but make accidental deletion and runtime compromise more damaging. Runtime DDL/EnsureCreated was rejected. Full event sourcing was also rejected: operational aggregates remain the authority, and the replay store is evidence/read state, not an alternate command engine.

This design increases bootstrap/reconciliation work and cannot protect against a database owner, host administrator or coordinated mutation of both records and hashes. Independent backups/retention remain necessary. A hash verifies stored text consistency; it is not a digital signature or external timestamp proof.

-- Terminal Fault<T> does not provide an authoritative retry total.
-- Existing numbered attempts remain intact; unknown terminal attempts are NULL.
ALTER TABLE delivery_attempts ALTER COLUMN "Attempt" DROP NOT NULL;
ALTER TABLE delivery_attempts ADD COLUMN "ConsumerService" text NOT NULL DEFAULT 'reporting';
ALTER TABLE delivery_attempts ADD COLUMN "FaultId" uuid;
ALTER TABLE delivery_attempts ADD COLUMN "OccurredAtUtc" timestamptz;
CREATE INDEX delivery_attempts_fault ON delivery_attempts("FaultId") WHERE "FaultId" IS NOT NULL;

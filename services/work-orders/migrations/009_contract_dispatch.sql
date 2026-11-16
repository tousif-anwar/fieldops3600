-- Additive snapshots; historical jobs remain explicitly unevaluated.
ALTER TABLE work_orders ADD COLUMN "MaintenanceVisitId" uuid;
ALTER TABLE work_orders ADD COLUMN "ContractId" uuid;
ALTER TABLE work_orders ADD COLUMN "ContractLineId" uuid;
ALTER TABLE work_orders ADD COLUMN "CoverageEvaluatedAtUtc" timestamptz;
ALTER TABLE work_orders ADD COLUMN "CoverageReason" text;
ALTER TABLE work_orders ADD COLUMN "ContractLaborCovered" boolean NOT NULL DEFAULT false;
ALTER TABLE work_orders ADD COLUMN "ContractPartsCovered" boolean NOT NULL DEFAULT false;
ALTER TABLE work_orders ADD COLUMN "FinancialAuthorizationRequired" boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX "IX_work_orders_MaintenanceVisitId" ON work_orders("MaintenanceVisitId") WHERE "MaintenanceVisitId" IS NOT NULL;
ALTER TABLE work_orders ADD CONSTRAINT "CK_work_order_contract_reference" CHECK (
  ("ContractId" IS NULL AND "ContractLineId" IS NULL) OR ("ContractId" IS NOT NULL AND "ContractLineId" IS NOT NULL));

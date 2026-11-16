ALTER TABLE maintenance_plans ADD COLUMN "ServiceLocationId" uuid REFERENCES service_locations("Id") ON DELETE RESTRICT;
ALTER TABLE maintenance_visits ADD COLUMN "ServiceLocationId" uuid REFERENCES service_locations("Id") ON DELETE RESTRICT;
ALTER TABLE maintenance_visits DROP CONSTRAINT "maintenance_visits_Status_check";
ALTER TABLE maintenance_visits ADD CONSTRAINT "CK_maintenance_visit_lifecycle"
  CHECK ("Status" IN ('Pending','Dispatching','Created','Scheduled','Completed','Missed','Cancelled'));
CREATE UNIQUE INDEX "UX_maintenance_visit_order" ON maintenance_visits("WorkOrderId") WHERE "WorkOrderId" IS NOT NULL;

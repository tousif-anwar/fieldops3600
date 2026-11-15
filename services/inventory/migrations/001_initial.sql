CREATE TABLE outbox_messages ("Id" uuid PRIMARY KEY,"Body" jsonb NOT NULL,"CreatedAtUtc" timestamptz NOT NULL,"PublishedAtUtc" timestamptz,"Attempts" integer NOT NULL,"NextAttemptAtUtc" timestamptz NOT NULL,"LastError" text);
CREATE INDEX ix_inventory_outbox_due ON outbox_messages("PublishedAtUtc","NextAttemptAtUtc");
CREATE TABLE inbox_messages ("Id" text PRIMARY KEY,"ProcessedAtUtc" timestamptz NOT NULL);
CREATE TABLE idempotency_receipts ("Id" text PRIMARY KEY,"ActorId" text NOT NULL,"RequestHash" text NOT NULL,"ResponseJson" text NOT NULL,"CreatedAtUtc" timestamptz NOT NULL);
CREATE TABLE inventory_parts (
 "Id" uuid PRIMARY KEY,"TeamId" text NOT NULL,"Sku" text NOT NULL,"Name" text NOT NULL,"Category" text NOT NULL,"Unit" text NOT NULL,"Currency" text NOT NULL,
 "UnitCost" numeric(18,4) NOT NULL CHECK("UnitCost">=0),"ReorderPoint" numeric(18,3) NOT NULL CHECK("ReorderPoint">=0),"ReorderQuantity" numeric(18,3) NOT NULL CHECK("ReorderQuantity">=0),"Active" boolean NOT NULL,"Version" integer NOT NULL CHECK("Version">0),
 UNIQUE("TeamId","Sku"),CHECK(length("TeamId")>0),CHECK("Currency" ~ '^[A-Z]{3}$')
);
CREATE TABLE stock_locations (
 "Id" uuid PRIMARY KEY,"TeamId" text NOT NULL,"Name" text NOT NULL,"Kind" text NOT NULL,"TechnicianId" text,"Active" boolean NOT NULL,"Version" integer NOT NULL CHECK("Version">0),
 CHECK("Kind" IN ('CentralWarehouse','RegionalWarehouse','Vehicle','Other')),CHECK(("Kind"='Vehicle' AND length("TechnicianId")>0) OR ("Kind"<>'Vehicle' AND "TechnicianId" IS NULL))
);
CREATE UNIQUE INDEX ux_inventory_active_vehicle ON stock_locations("TeamId","TechnicianId") WHERE "Kind"='Vehicle' AND "Active";
CREATE TABLE stock_balances (
 "PartId" uuid NOT NULL REFERENCES inventory_parts("Id"),"LocationId" uuid NOT NULL REFERENCES stock_locations("Id"),"OnHand" numeric(18,3) NOT NULL,"Reserved" numeric(18,3) NOT NULL,"Version" integer NOT NULL CHECK("Version">0),
 PRIMARY KEY("PartId","LocationId"),CHECK("OnHand">=0 AND "Reserved">=0 AND "Reserved"<="OnHand")
);
CREATE TABLE inventory_reservations (
 "Id" uuid PRIMARY KEY,"TeamId" text NOT NULL,"WorkOrderId" uuid NOT NULL,"PartId" uuid NOT NULL REFERENCES inventory_parts("Id"),"LocationId" uuid NOT NULL REFERENCES stock_locations("Id"),
 "Quantity" numeric(18,3) NOT NULL CHECK("Quantity">0),"ConsumedQuantity" numeric(18,3) NOT NULL CHECK("ConsumedQuantity">=0),"ReleasedQuantity" numeric(18,3) NOT NULL CHECK("ReleasedQuantity">=0),
 "Status" text NOT NULL CHECK("Status" IN ('Active','Closed')),"ActorId" text NOT NULL,"CreatedAtUtc" timestamptz NOT NULL,
 CHECK("ConsumedQuantity"+"ReleasedQuantity"<="Quantity"),CHECK(("Status"='Active' AND "ConsumedQuantity"+"ReleasedQuantity"<"Quantity") OR ("Status"='Closed' AND "ConsumedQuantity"+"ReleasedQuantity"="Quantity"))
);
CREATE UNIQUE INDEX ux_inventory_open_reservation ON inventory_reservations("WorkOrderId","PartId","LocationId") WHERE "Status"='Active';
CREATE TABLE stock_transfers (
 "Id" uuid PRIMARY KEY,"TeamId" text NOT NULL,"PartId" uuid NOT NULL REFERENCES inventory_parts("Id"),"SourceLocationId" uuid NOT NULL REFERENCES stock_locations("Id"),"DestinationLocationId" uuid NOT NULL REFERENCES stock_locations("Id"),"WorkOrderId" uuid,
 "Quantity" numeric(18,3) NOT NULL CHECK("Quantity">0),"ReceivedQuantity" numeric(18,3) NOT NULL CHECK("ReceivedQuantity">=0 AND "ReceivedQuantity"<="Quantity"),"Status" text NOT NULL CHECK("Status" IN ('InTransit','Received')),"ActorId" text NOT NULL,"CreatedAtUtc" timestamptz NOT NULL,"ReceivedAtUtc" timestamptz,
 CHECK("SourceLocationId"<>"DestinationLocationId"),CHECK(("Status"='Received' AND "ReceivedQuantity"="Quantity" AND "ReceivedAtUtc" IS NOT NULL) OR ("Status"='InTransit' AND "ReceivedQuantity"<"Quantity" AND "ReceivedAtUtc" IS NULL))
);
CREATE TABLE inventory_consumptions (
 "Id" uuid PRIMARY KEY,"TeamId" text NOT NULL,"WorkOrderId" uuid NOT NULL,"PartId" uuid NOT NULL REFERENCES inventory_parts("Id"),"LocationId" uuid NOT NULL REFERENCES stock_locations("Id"),"ReservationId" uuid REFERENCES inventory_reservations("Id"),
 "Quantity" numeric(18,3) NOT NULL CHECK("Quantity">0),"ReturnedQuantity" numeric(18,3) NOT NULL CHECK("ReturnedQuantity">=0 AND "ReturnedQuantity"<="Quantity"),"UnitCost" numeric(18,4) NOT NULL CHECK("UnitCost">=0),"Currency" text NOT NULL CHECK("Currency" ~ '^[A-Z]{3}$'),"ActorId" text NOT NULL,"CreatedAtUtc" timestamptz NOT NULL
);
CREATE TABLE inventory_movements (
 "Id" uuid PRIMARY KEY,"TeamId" text NOT NULL,"PartId" uuid NOT NULL REFERENCES inventory_parts("Id"),"SourceLocationId" uuid REFERENCES stock_locations("Id"),"DestinationLocationId" uuid REFERENCES stock_locations("Id"),"WorkOrderId" uuid,"ReferenceId" uuid NOT NULL,
 "Kind" text NOT NULL CHECK("Kind" IN ('Receipt','Reservation','Release','TransferSent','TransferReceived','Consumption','Return','Adjustment')),"Quantity" numeric(18,3) NOT NULL CHECK("Quantity"<>0),"Reason" text NOT NULL,"ActorId" text NOT NULL,"ActorRole" text NOT NULL,"CorrelationId" text NOT NULL,"OccurredAtUtc" timestamptz NOT NULL
);
CREATE INDEX ix_inventory_movement_audit ON inventory_movements("TeamId","OccurredAtUtc");
CREATE TABLE inventory_part_requests (
 "Id" uuid PRIMARY KEY,"TeamId" text NOT NULL,"WorkOrderId" uuid NOT NULL,"PartId" uuid NOT NULL REFERENCES inventory_parts("Id"),"Quantity" numeric(18,3) NOT NULL CHECK("Quantity">0),"Kind" text NOT NULL CHECK("Kind" IN ('Missing','Additional')),"Reason" text NOT NULL,"Status" text NOT NULL CHECK("Status" IN ('Open','Closed')),"ActorId" text NOT NULL,"ClosedBy" text,"Resolution" text,"CreatedAtUtc" timestamptz NOT NULL,"ClosedAtUtc" timestamptz,
 CHECK(("Status"='Open' AND "ClosedAtUtc" IS NULL) OR ("Status"='Closed' AND "ClosedAtUtc" IS NOT NULL AND "ClosedBy" IS NOT NULL AND "Resolution" IS NOT NULL))
);
CREATE FUNCTION protect_inventory_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Inventory movement evidence is append-only' USING ERRCODE='42501'; END $$;
CREATE TRIGGER inventory_movement_immutable BEFORE UPDATE OR DELETE ON inventory_movements FOR EACH ROW EXECUTE FUNCTION protect_inventory_evidence();
CREATE TRIGGER inventory_movement_no_truncate BEFORE TRUNCATE ON inventory_movements FOR EACH STATEMENT EXECUTE FUNCTION protect_inventory_evidence();

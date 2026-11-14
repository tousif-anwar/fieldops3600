-- Invitations do not reserve technician capacity. Acceptance and its booking commit together.
CREATE TABLE assignment_offers (
    "Id" uuid NOT NULL PRIMARY KEY,
    "WorkOrderId" uuid NOT NULL,
    "TechnicianId" text NOT NULL CHECK (btrim("TechnicianId") <> ''),
    "TeamId" text NOT NULL CHECK (btrim("TeamId") <> ''),
    "WorkOrderNumber" text NOT NULL,
    "Title" text NOT NULL,
    "SiteAddress" text NOT NULL,
    "ServiceCategory" text NOT NULL,
    "Priority" text NOT NULL,
    "StartUtc" timestamptz NOT NULL,
    "EndUtc" timestamptz NOT NULL,
    "ExpiresAtUtc" timestamptz NOT NULL,
    "CreatedAtUtc" timestamptz NOT NULL,
    "RespondedAtUtc" timestamptz,
    "Status" text NOT NULL DEFAULT 'Pending' CHECK ("Status" IN ('Pending','Accepted','Declined','Revoked','Expired')),
    "Version" integer NOT NULL DEFAULT 1 CHECK ("Version" > 0),
    "Reason" text,
    "BookingId" uuid REFERENCES bookings("Id") ON DELETE RESTRICT,
    CHECK ("EndUtc" > "StartUtc" AND "EndUtc" - "StartUtc" <= interval '8 hours'),
    CHECK ("ExpiresAtUtc" > "CreatedAtUtc" AND "ExpiresAtUtc" <= "StartUtc" AND "ExpiresAtUtc" <= "CreatedAtUtc" + interval '24 hours'),
    CHECK (("Status" = 'Accepted') = ("BookingId" IS NOT NULL)),
    CHECK (("Status" = 'Pending') = ("RespondedAtUtc" IS NULL)),
    CHECK ("Status" NOT IN ('Declined','Revoked') OR ("Reason" IS NOT NULL AND length(btrim("Reason")) BETWEEN 3 AND 500))
);
CREATE UNIQUE INDEX one_pending_offer_per_order ON assignment_offers("WorkOrderId") WHERE "Status" = 'Pending';
CREATE INDEX assignment_offers_inbox ON assignment_offers("TeamId","TechnicianId","ExpiresAtUtc");
CREATE INDEX assignment_offers_expiration ON assignment_offers("ExpiresAtUtc") WHERE "Status" = 'Pending';

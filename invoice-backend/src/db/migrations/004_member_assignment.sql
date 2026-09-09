-- Repoint claims.assigned_to/created_by and invoices.technician_id/
-- reviewed_by from users.id to organization_members.id. Deferred from the
-- multi-tenancy foundation migration (002) — now that invitations make
-- multi-org-per-user real, "assigned to this user" is ambiguous (which of
-- their org memberships?) while "assigned to this membership" isn't.
--
-- Column names are kept the same (assigned_to, created_by, technician_id,
-- reviewed_by) via add-backfill-drop-rename, specifically to minimize the
-- footprint of the accompanying code changes to just what values flow
-- through them and what they join against — not every SQL reference to
-- the column name itself.

BEGIN;

ALTER TABLE claims ADD COLUMN assigned_member_id UUID REFERENCES organization_members(id);
ALTER TABLE claims ADD COLUMN created_by_member_id UUID REFERENCES organization_members(id);
ALTER TABLE invoices ADD COLUMN technician_member_id UUID REFERENCES organization_members(id);
ALTER TABLE invoices ADD COLUMN reviewed_by_member_id UUID REFERENCES organization_members(id);

UPDATE claims c SET assigned_member_id = om.id
FROM organization_members om
WHERE om.user_id = c.assigned_to AND om.organization_id = c.organization_id AND c.assigned_to IS NOT NULL;

UPDATE claims c SET created_by_member_id = om.id
FROM organization_members om
WHERE om.user_id = c.created_by AND om.organization_id = c.organization_id AND c.created_by IS NOT NULL;

UPDATE invoices i SET technician_member_id = om.id
FROM organization_members om
WHERE om.user_id = i.technician_id AND om.organization_id = i.organization_id AND i.technician_id IS NOT NULL;

UPDATE invoices i SET reviewed_by_member_id = om.id
FROM organization_members om
WHERE om.user_id = i.reviewed_by AND om.organization_id = i.organization_id AND i.reviewed_by IS NOT NULL;

ALTER TABLE claims DROP COLUMN assigned_to;
ALTER TABLE claims DROP COLUMN created_by;
ALTER TABLE claims RENAME COLUMN assigned_member_id TO assigned_to;
ALTER TABLE claims RENAME COLUMN created_by_member_id TO created_by;

ALTER TABLE invoices DROP COLUMN technician_id;
ALTER TABLE invoices DROP COLUMN reviewed_by;
ALTER TABLE invoices RENAME COLUMN technician_member_id TO technician_id;
ALTER TABLE invoices RENAME COLUMN reviewed_by_member_id TO reviewed_by;

-- Dropping the old columns dropped their indexes too — recreate on the
-- renamed columns for the same query-performance characteristics.
CREATE INDEX idx_claims_assigned_to ON claims(assigned_to);
CREATE INDEX idx_invoices_technician_id ON invoices(technician_id);

COMMIT;

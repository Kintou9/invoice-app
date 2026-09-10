-- Migration: bring audit_log up to date with multi-tenancy
--
-- audit_log was created in 001_initial_schema.sql, before organizations/
-- organization_members existed, and was never touched during the
-- multi-tenancy work — it has no organization_id (so it can't be scoped or
-- queried per-org) and performed_by still references users(id) instead of
-- organization_members(id), unlike every other actor-tracking column in
-- the schema (claims.assigned_to/created_by, invoices.technician_id/
-- reviewed_by, part_purchases.created_by). Table is empty (0 rows), so
-- this is a clean structural fix with nothing to backfill.

BEGIN;

ALTER TABLE audit_log ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE audit_log ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE audit_log DROP CONSTRAINT audit_log_performed_by_fkey;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_performed_by_fkey
  FOREIGN KEY (performed_by) REFERENCES organization_members(id);

CREATE INDEX idx_audit_log_org_created ON audit_log(organization_id, created_at DESC);

-- 001_initial_schema.sql already created idx_audit_entity on the same
-- (entity_type, entity_id) columns — no need for a second, identical index.

COMMIT;

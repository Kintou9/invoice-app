-- Adds a read-only "viewer" role and a "removed" status (soft-delete for a
-- member with real history — see notes in routes/users.js for why a hard
-- DELETE isn't safe once a member has any claims/invoices/audit rows).
ALTER TABLE organization_members DROP CONSTRAINT organization_members_role_check;
ALTER TABLE organization_members ADD CONSTRAINT organization_members_role_check
  CHECK (role IN ('owner', 'manager', 'worker', 'viewer'));

ALTER TABLE organization_members DROP CONSTRAINT organization_members_status_check;
ALTER TABLE organization_members ADD CONSTRAINT organization_members_status_check
  CHECK (status IN ('invited', 'active', 'disabled', 'removed'));

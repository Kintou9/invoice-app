-- Multi-tenancy foundation: organizations + organization_members, and
-- organization_id on every company-owned table. Existing 2 users are
-- migrated into one default organization (admin -> owner, technician ->
-- worker) so nothing changes observably for them.
--
-- Applied directly against the live DB on 2026-09-07 via a one-off Node
-- script (same pattern as every other DB change this session), not through
-- Azure Query Editor. This file is the checked-in historical record of
-- exactly what ran, including the literal default-org UUID used.

BEGIN;

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL CHECK (role IN ('owner','manager','worker')),
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','disabled')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX idx_org_members_user ON organization_members(user_id);
CREATE INDEX idx_org_members_org ON organization_members(organization_id);

ALTER TABLE claims ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE invoices ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE parts ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE invoice_templates ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE claim_templates ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE supplier_sites ADD COLUMN organization_id UUID REFERENCES organizations(id);

INSERT INTO organizations (id, name) VALUES ('14cdd87f-b3f9-4ff9-a3a3-670572940dc9', 'Default Organization');

INSERT INTO organization_members (organization_id, user_id, role, status)
SELECT '14cdd87f-b3f9-4ff9-a3a3-670572940dc9', id,
       CASE role WHEN 'admin' THEN 'owner' WHEN 'technician' THEN 'worker' ELSE role END,
       CASE WHEN is_active THEN 'active' ELSE 'disabled' END
FROM users;

UPDATE claims SET organization_id = '14cdd87f-b3f9-4ff9-a3a3-670572940dc9';
UPDATE invoices SET organization_id = '14cdd87f-b3f9-4ff9-a3a3-670572940dc9';
UPDATE parts SET organization_id = '14cdd87f-b3f9-4ff9-a3a3-670572940dc9';
UPDATE claim_templates SET organization_id = '14cdd87f-b3f9-4ff9-a3a3-670572940dc9';
-- invoice_templates / supplier_sites had 0 rows at migration time, nothing to backfill

ALTER TABLE claims ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE invoices ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE parts ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE users DROP COLUMN role;
ALTER TABLE users DROP COLUMN is_active;

ALTER TABLE claims DROP CONSTRAINT claims_claim_number_key;
ALTER TABLE claims ADD CONSTRAINT claims_number_per_org UNIQUE (organization_id, claim_number);

COMMIT;

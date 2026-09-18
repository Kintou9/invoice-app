-- Industry-based workspace onboarding + configurable invoice templates.
--
-- invoice_field_templates is a NEW, separate concept from the existing
-- invoice_templates (owner-uploaded Word/PDF docs used to prompt Claude)
-- and claim_templates (photo-extraction guides) tables — deliberately not
-- reusing either name or table, to avoid conflating two unrelated things
-- that happen to share the word "template".
--
-- onboarding_status defaults to 'completed' so every existing organization
-- is safe automatically the instant this migration runs — no backfill
-- UPDATE needed, and no existing workspace is ever forced into onboarding.
-- Only POST /api/auth/register (new workspace creation) explicitly inserts
-- 'not_started'.
--
-- Applied directly against the live DB via the established one-off Node
-- script pattern (same DB for local + prod), not an automated runner.

BEGIN;

CREATE TABLE invoice_field_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),

  name VARCHAR(255) NOT NULL,
  industry_key VARCHAR(40) NOT NULL,

  is_default BOOLEAN NOT NULL DEFAULT false,
  is_archived BOOLEAN NOT NULL DEFAULT false,

  -- 'onboarding' rows are created by the onboarding wizard; used only to
  -- make a retried onboarding submission idempotent (see unique index
  -- below) rather than creating a duplicate template on every retry.
  created_via VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (created_via IN ('onboarding', 'manual')),

  logo_blob_url TEXT,
  contact_name VARCHAR(255),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  contact_address TEXT,

  payment_terms TEXT,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),

  optional_features JSONB NOT NULL DEFAULT
    '{"claim_number":false,"po_reference":false,"photos":true,"receipts":false,"notes":true}',

  -- Array of {id,label,type,section,visible,required,order,customerVisible}.
  -- One shape for all 7 industries + general — the difference between
  -- industries is only which fields get seeded here, never a code branch.
  fields JSONB NOT NULL DEFAULT '[]',

  -- Bumped on every content-affecting edit. Informational only — the real
  -- immutability guarantee for existing invoices is the per-invoice
  -- snapshot below, not this counter.
  version INTEGER NOT NULL DEFAULT 1,

  created_by UUID REFERENCES organization_members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_field_templates_org ON invoice_field_templates(organization_id);

-- At most one active default per org — DB-enforced, no app-level race.
CREATE UNIQUE INDEX idx_one_default_template_per_org
  ON invoice_field_templates(organization_id) WHERE is_default AND NOT is_archived;

-- At most one onboarding-created row per org, so a retried "complete
-- onboarding" submission (double-click, network retry) upserts this one
-- row via ON CONFLICT instead of inserting a duplicate.
CREATE UNIQUE INDEX idx_one_onboarding_template_per_org
  ON invoice_field_templates(organization_id) WHERE created_via = 'onboarding';

ALTER TABLE organizations ADD COLUMN onboarding_status VARCHAR(20) NOT NULL DEFAULT 'completed'
  CHECK (onboarding_status IN ('not_started', 'in_progress', 'completed'));
ALTER TABLE organizations ADD COLUMN onboarding_step VARCHAR(30)
  CHECK (onboarding_step IN ('business_type', 'customize') OR onboarding_step IS NULL);
ALTER TABLE organizations ADD COLUMN onboarding_business_type VARCHAR(40);

-- Template linkage + frozen snapshot + industry field answers on invoices.
-- field_template_snapshot is copied from invoice_field_templates at
-- creation time (and re-copied on template switch while still a draft) so
-- a later template edit never silently changes an existing invoice or its
-- generated PDF.
ALTER TABLE invoices ADD COLUMN field_template_id UUID REFERENCES invoice_field_templates(id);
ALTER TABLE invoices ADD COLUMN field_template_snapshot JSONB;
ALTER TABLE invoices ADD COLUMN field_values JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE invoices ADD COLUMN tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0
  CHECK (tax_rate >= 0 AND tax_rate <= 100);
ALTER TABLE invoices ADD COLUMN pdf_blob_url TEXT;
ALTER TABLE invoices ADD COLUMN pdf_generated_at TIMESTAMPTZ;

-- Unit for line items whose quantity isn't a bare count (sq ft, hours) —
-- nullable, existing rows unaffected.
ALTER TABLE invoice_line_items ADD COLUMN unit VARCHAR(20);

COMMIT;

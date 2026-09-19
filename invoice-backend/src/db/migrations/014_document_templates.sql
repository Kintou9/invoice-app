-- Upload-your-own-form template system. Additive only — the existing
-- invoice_field_templates flat-field system is untouched and keeps working;
-- these tables back the new "upload a PDF/photo and map it onto its own
-- original layout" capability, surfaced alongside the old system in one
-- renamed "Document Templates" library page.

CREATE TABLE document_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category VARCHAR(20) NOT NULL CHECK (category IN ('job_claim', 'invoice', 'combined')),
  source_type VARCHAR(10) NOT NULL CHECK (source_type IN ('uploaded', 'built')),
  -- 'built' templates just surface an existing invoice_field_templates row in
  -- this same library — no data duplicated, this is purely a pointer.
  built_from_field_template_id UUID REFERENCES invoice_field_templates(id),
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'processing', 'needs_review', 'active', 'archived', 'failed')),
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_default_invoice BOOLEAN NOT NULL DEFAULT false,
  is_default_job_claim BOOLEAN NOT NULL DEFAULT false,
  allow_manual_edits BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES organization_members(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX idx_document_templates_org ON document_templates(organization_id);

-- Editing an active template creates a new draft version rather than
-- mutating the live one; activation flips this row to 'active' and demotes
-- whichever version previously held that title to 'archived'. Exactly one
-- version per template should be 'active' at a time (enforced in the route,
-- not a DB constraint, since Postgres partial-unique-on-status needs the
-- same WHERE-scoped index pattern already used for invoice_field_templates'
-- is_default).
CREATE TABLE template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'processing', 'needs_review', 'active', 'archived', 'failed')),
  source_blob_url TEXT,
  detection_confidence VARCHAR(10) CHECK (detection_confidence IN ('high', 'medium', 'low') OR detection_confidence IS NULL),
  page_count INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES organization_members(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (template_id, version_number)
);
CREATE INDEX idx_template_versions_template ON template_versions(template_id);
CREATE UNIQUE INDEX idx_one_active_version_per_template ON template_versions(template_id) WHERE status = 'active';

-- The rendered page image (original PDF page rasterized client-side, or the
-- photo/PNG/JPG as uploaded) — this backs the mapping canvas background and
-- the library thumbnail. width/height are its real pixel dimensions, kept
-- so normalized 0..1 field coordinates can be scaled back to real pixels at
-- any render size.
CREATE TABLE template_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id UUID NOT NULL REFERENCES template_versions(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  image_blob_url TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  UNIQUE (version_id, page_number)
);

CREATE TABLE template_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id UUID NOT NULL REFERENCES template_versions(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL DEFAULT 1,
  field_key VARCHAR(60) NOT NULL,
  label TEXT NOT NULL,
  field_type VARCHAR(20) NOT NULL DEFAULT 'text' CHECK (field_type IN ('text', 'table', 'signature', 'photo')),
  -- Document-relative fractions (0..1), not raw pixels, so a mapping stays
  -- aligned at any zoom level or render size.
  x NUMERIC(7,6) NOT NULL DEFAULT 0,
  y NUMERIC(7,6) NOT NULL DEFAULT 0,
  width NUMERIC(7,6) NOT NULL DEFAULT 0,
  height NUMERIC(7,6) NOT NULL DEFAULT 0,
  placed BOOLEAN NOT NULL DEFAULT false,
  required BOOLEAN NOT NULL DEFAULT false,
  sample_value TEXT,
  format_options JSONB,
  detection_confidence VARCHAR(10) CHECK (detection_confidence IN ('high', 'medium', 'low') OR detection_confidence IS NULL),
  reviewed BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_template_fields_version ON template_fields(version_id);

CREATE TABLE template_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
  scope VARCHAR(20) NOT NULL CHECK (scope IN ('organization', 'service', 'industry', 'insurance')),
  scope_value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_template_assignments_org ON template_assignments(organization_id);

-- Frozen record of what was actually generated — version_id is what makes
-- "editing a template later must not silently alter previously finalized
-- invoices" true, and field_values is a snapshot of what was actually filled
-- in at generation time (independent of what the linked claim/invoice rows
-- say today).
CREATE TABLE generated_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  template_id UUID REFERENCES document_templates(id),
  version_id UUID REFERENCES template_versions(id),
  claim_id UUID REFERENCES claims(id),
  invoice_id UUID REFERENCES invoices(id),
  pdf_blob_url TEXT NOT NULL,
  field_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_by UUID REFERENCES organization_members(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_generated_documents_org ON generated_documents(organization_id);

-- The only real per-claim "which insurer" concept in the app today — needed
-- so template_assignments' 'insurance' scope has something real to match
-- against instead of being decorative.
ALTER TABLE claims ADD COLUMN insurance_company TEXT;

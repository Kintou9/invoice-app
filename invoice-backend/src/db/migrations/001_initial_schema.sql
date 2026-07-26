-- Roles: admin, manager, technician
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'manager', 'technician')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Invoice templates uploaded by admin
CREATE TABLE invoice_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  blob_url TEXT NOT NULL,
  prompt_text TEXT,
  is_active BOOLEAN DEFAULT true,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Claims assigned to technicians
CREATE TABLE claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_number VARCHAR(100) UNIQUE NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  assigned_to UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  status VARCHAR(50) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'pending_approval', 'approved', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Invoices linked to claims
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID REFERENCES claims(id) ON DELETE CASCADE,
  template_id UUID REFERENCES invoice_templates(id),
  technician_id UUID REFERENCES users(id),
  model_number VARCHAR(255),
  serial_number VARCHAR(255),
  issue_description TEXT,
  ai_generated_description TEXT,
  filled_blob_url TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  manager_notes TEXT,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Photos uploaded by technician for a given invoice
CREATE TABLE invoice_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  blob_url TEXT NOT NULL,
  extracted_model VARCHAR(255),
  extracted_serial VARCHAR(255),
  raw_ai_response TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Parts identified per invoice
CREATE TABLE parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  name VARCHAR(500) NOT NULL,
  part_number VARCHAR(255),
  quantity INTEGER DEFAULT 1,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Supplier links attached to parts (many-to-many via junction)
CREATE TABLE part_supplier_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID REFERENCES parts(id) ON DELETE CASCADE,
  supplier_name VARCHAR(255),
  url TEXT NOT NULL,
  price_note VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Company-configured supplier sites (admin managed)
CREATE TABLE supplier_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  base_url TEXT NOT NULL,
  logo_url TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit log
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  action VARCHAR(100) NOT NULL,
  performed_by UUID REFERENCES users(id),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_claims_assigned_to ON claims(assigned_to);
CREATE INDEX idx_claims_status ON claims(status);
CREATE INDEX idx_invoices_claim_id ON invoices(claim_id);
CREATE INDEX idx_invoices_technician_id ON invoices(technician_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_parts_invoice_id ON parts(invoice_id);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);

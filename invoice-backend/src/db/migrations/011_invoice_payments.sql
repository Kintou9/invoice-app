-- due_date doubles as the "has this invoice actually been issued to the
-- customer" signal (set the first time a PDF is generated, see
-- generateAndStorePdf in routes/invoices.js) — null means "ready to send",
-- not yet due.
ALTER TABLE invoices ADD COLUMN due_date DATE;

-- Payments are tracked separately from the invoice itself so a partial
-- payment history survives (who recorded what, when, how) rather than
-- collapsing to a single amount_paid counter.
CREATE TABLE invoice_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  method VARCHAR(10) CHECK (method IN ('cash', 'card', 'check', 'other') OR method IS NULL),
  notes TEXT,
  recorded_by UUID REFERENCES organization_members(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_invoice_payments_invoice_id ON invoice_payments(invoice_id);
CREATE INDEX idx_invoice_payments_org_recorded_at ON invoice_payments(organization_id, recorded_at);

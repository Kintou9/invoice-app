-- Migration: part purchases + invoice line items
--
-- part_purchases tracks parts actually sourced/bought for a claim: real
-- cost, supplier, order/tracking info, delivery status, and (once billed)
-- the invoice line item it turned into. Anchored to claim_id rather than
-- invoice_id — a purchase typically happens on-site the moment a tech buys
-- a part, before any invoice document exists yet for that claim.
--
-- invoice_line_items is the first monetary concept on invoices in this
-- app — until now invoices carried no dollar amounts at all (they're
-- filled-PDF document records with an approve/reject workflow). This adds
-- billing-with-markup: a purchase's real cost vs. what the customer is
-- charged for it.

BEGIN;

CREATE TABLE invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  invoice_id UUID NOT NULL REFERENCES invoices(id),

  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  total_price NUMERIC(10,2) GENERATED ALWAYS AS (unit_price * quantity) STORED,

  -- All-in cost basis for this line (unit cost * qty + shipping + tax when
  -- sourced from a part_purchases row); null for line items with no tracked
  -- purchase behind them.
  cost NUMERIC(10,2) CHECK (cost IS NULL OR cost >= 0),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoice_line_items_invoice ON invoice_line_items(invoice_id);
CREATE INDEX idx_invoice_line_items_org ON invoice_line_items(organization_id);

CREATE TABLE part_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id UUID NOT NULL REFERENCES organizations(id),
  claim_id UUID NOT NULL REFERENCES claims(id),

  part_description TEXT NOT NULL,
  part_number TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),

  supplier_name TEXT,

  unit_cost NUMERIC(10,2) NOT NULL CHECK (unit_cost >= 0),
  shipping_cost NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
  tax NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total_cost NUMERIC(10,2) GENERATED ALWAYS AS
    ((unit_cost * quantity) + shipping_cost + tax) STORED,

  product_url TEXT,
  tracking_url TEXT,
  order_number TEXT,
  tracking_number TEXT,

  status TEXT NOT NULL DEFAULT 'ordered'
    CHECK (status IN ('ordered', 'shipped', 'delivered', 'returned', 'refunded', 'cancelled')),
  purchase_date DATE,
  refund_amount NUMERIC(10,2) CHECK (refund_amount IS NULL OR refund_amount >= 0),

  invoice_line_item_id UUID REFERENCES invoice_line_items(id),
  -- Azure Blob Storage URL, same pattern as invoice_photos.blob_url — this
  -- app has no separate "documents" table for uploaded files.
  receipt_blob_url TEXT,

  -- organization_members.id, not users.id — matches assigned_to/created_by
  -- on claims and technician_id/reviewed_by on invoices (a person's acting
  -- identity is their membership within an org, not their bare user row).
  created_by UUID NOT NULL REFERENCES organization_members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_part_purchases_claim ON part_purchases(claim_id);
CREATE INDEX idx_part_purchases_org ON part_purchases(organization_id);
CREATE INDEX idx_part_purchases_invoice_line_item ON part_purchases(invoice_line_item_id);

COMMIT;

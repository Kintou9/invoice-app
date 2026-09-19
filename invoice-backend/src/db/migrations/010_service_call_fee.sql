-- A flat fee for showing up to the job, separate from parts/labor line
-- items, plus how the customer paid it. Both live on the invoice (billing),
-- not the claim (job record) — the claim has no cost concept of its own.
ALTER TABLE invoices ADD COLUMN service_call_fee NUMERIC(10,2) NOT NULL DEFAULT 0
  CHECK (service_call_fee >= 0);
ALTER TABLE invoices ADD COLUMN payment_method VARCHAR(10)
  CHECK (payment_method IN ('cash', 'card', 'check') OR payment_method IS NULL);

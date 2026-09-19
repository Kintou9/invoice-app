// The billing status shown on the manager's Invoices page is derived, not a
// literal invoices.status value — it folds in whether the invoice has been
// issued (due_date gets stamped the first time a PDF is generated, see
// generateAndStorePdf in the backend) and how much of it has been paid.
// "Rejected" is its own badge/label but buckets into the "draft" tab, since
// both are pre-approval states the technician can still edit.
export function getBillingStatus(invoice) {
  if (invoice.status === 'rejected') return 'rejected';
  if (invoice.status === 'draft') return 'draft';
  if (invoice.status === 'submitted') return 'needs_approval';
  // approved:
  if (!invoice.due_date) return 'ready_to_send';
  const total = Number(invoice.invoice_total) || 0;
  const paid = Number(invoice.amount_paid) || 0;
  if (paid <= 0) return 'unpaid';
  if (paid < total - 0.005) return 'part_paid';
  return 'paid';
}

export const BILLING_STATUS = {
  draft: { label: 'Draft', tone: 'gray', tab: 'draft' },
  rejected: { label: 'Rejected', tone: 'red', tab: 'draft' },
  needs_approval: { label: 'Needs approval', tone: 'orange', tab: 'needs_approval' },
  ready_to_send: { label: 'Ready to send', tone: 'blue', tab: 'ready_to_send' },
  unpaid: { label: 'Unpaid', tone: 'red', tab: 'unpaid' },
  part_paid: { label: 'Part paid', tone: 'green', tab: 'unpaid' },
  paid: { label: 'Paid', tone: 'green', tab: 'paid' },
};

export function isOverdue(invoice) {
  if (!invoice.due_date) return false;
  const status = getBillingStatus(invoice);
  if (status !== 'unpaid' && status !== 'part_paid') return false;
  return new Date(invoice.due_date) < new Date(new Date().toDateString());
}

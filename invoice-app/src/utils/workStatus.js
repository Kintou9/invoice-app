// The "Work status" shown for a job is derived, not a literal claims.status
// value — it folds in assignment and whether the job has been billed yet, so
// job views read as a real job-tracking board rather than a raw status dump.
// "Ready to invoice" specifically means: assigned, work underway or open, and
// no invoice has been started for it yet. Shared by the Jobs list and the
// job detail page so the badge/label is always consistent between them.
export function getWorkStatus(claim, claimInvoices) {
  if (!claim.assigned_to) return 'unassigned';
  if (claim.status === 'pending_approval') return 'needs_review';
  if (claim.status === 'approved') return 'approved';
  if (claim.status === 'rejected') return 'rejected';
  if ((claim.status === 'open' || claim.status === 'in_progress') && claimInvoices.length === 0) return 'ready_to_invoice';
  if (claim.status === 'in_progress') return 'in_progress';
  return 'scheduled';
}

export const WORK_STATUS = {
  unassigned: { label: 'Unassigned', tone: 'gray' },
  scheduled: { label: 'Scheduled', tone: 'blue' },
  in_progress: { label: 'In progress', tone: 'blue' },
  needs_review: { label: 'Needs review', tone: 'orange' },
  ready_to_invoice: { label: 'Ready to invoice', tone: 'green' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
};

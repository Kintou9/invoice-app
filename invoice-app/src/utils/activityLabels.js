// Human-readable rendering of an /api/audit-log entry — shared by
// DashboardPage's "Recent activity" and ClaimsPage's "Latest worker
// updates", both of which show the same underlying feed.

const EVENT_LABELS = {
  claim: { create: 'Claim created', edit: 'Claim updated', delete: 'Claim deleted' },
  invoice: {
    create: 'Invoice started', submit: 'Invoice submitted', approve: 'Invoice approved',
    reject: 'Invoice rejected', edit: 'Invoice updated',
    record_payment: 'Payment recorded', delete_payment: 'Payment removed',
  },
  invoice_field_template: { create: 'Template created', edit: 'Template updated', archive: 'Template archived', onboarding_complete: 'Onboarding completed' },
  organization_member: {
    accept_invite: 'Invite accepted', invite: 'Member invited', edit: 'Member updated',
    resend_invite: 'Invite resent', cancel_invite: 'Invite canceled', role_change: 'Role changed',
    suspend: 'Member suspended', reactivate: 'Member reactivated', remove: 'Member removed',
    transfer_ownership: 'Ownership transferred',
  },
  part_purchase: { create: 'Part ordered', edit: 'Part purchase updated', delete: 'Part purchase removed', add_to_invoice: 'Part billed to invoice' },
};

export function eventLabel(entry) {
  return EVENT_LABELS[entry.entity_type]?.[entry.action] || `${entry.entity_type} ${entry.action}`.replace('_', ' ');
}

// Best-effort pull of a couple of well-known metadata keys — shapes vary
// per action, there's no per-entity display-name join on this endpoint.
export function eventDetails(entry) {
  const m = entry.metadata || {};
  const amount = typeof m.amount === 'number' ? `$${m.amount.toFixed(2)}${m.method ? ` (${m.method})` : ''}` : null;
  const roleChange = m.old_role && m.new_role ? `${m.old_role} → ${m.new_role}` : null;
  return [m.claim_number, m.customer_name, m.name, m.organization_name, amount, roleChange].filter(Boolean).join(' — ');
}

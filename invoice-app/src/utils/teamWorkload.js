// Turns a member row's raw workload counts (from GET /api/users) into the
// short summary string shown in the Team table and drawer — pure display
// formatting, no scores or rankings, just real current job counts.
export function formatWorkload(member) {
  if (member.role === 'owner') return '—';
  if (member.role === 'viewer') return 'Read only';
  if (!member.workload) return '—';

  if (member.role === 'manager') {
    const { org_open_jobs, org_pending_review } = member.workload;
    return `${org_open_jobs} open · ${org_pending_review} review${org_pending_review === 1 ? '' : 's'}`;
  }

  // worker — list whichever categories are non-zero, in priority order,
  // capped at two so the table cell stays scannable.
  const { active_jobs, awaiting_review, waiting_for_parts, scheduled_today } = member.workload;
  const parts = [];
  if (active_jobs > 0) parts.push(`${active_jobs} active`);
  if (awaiting_review > 0) parts.push(`${awaiting_review} awaiting review`);
  if (waiting_for_parts > 0) parts.push(`${waiting_for_parts} waiting for parts`);
  if (scheduled_today > 0) parts.push(`${scheduled_today} scheduled today`);
  if (parts.length === 0) return 'No active jobs';
  return parts.slice(0, 2).join(' · ');
}

const db = require('../db');

/**
 * Create a single in-app notification for one member.
 */
async function notify({ organizationId, recipientMemberId, type, message, link }) {
  await db.query(
    `INSERT INTO notifications (organization_id, recipient_member_id, type, message, link)
     VALUES ($1, $2, $3, $4, $5)`,
    [organizationId, recipientMemberId, type, message, link || null]
  );
}

/**
 * Create the same notification for every active owner/manager in an org —
 * "someone needs to review this" doesn't have one specific recipient.
 */
async function notifyReviewers({ organizationId, type, message, link }) {
  const { rows } = await db.query(
    `SELECT id FROM organization_members
     WHERE organization_id = $1 AND role IN ('owner', 'manager') AND status = 'active'`,
    [organizationId]
  );
  await Promise.all(
    rows.map((r) => notify({ organizationId, recipientMemberId: r.id, type, message, link }))
  );
}

module.exports = { notify, notifyReviewers };

const db = require('../db');

/**
 * Record one audit trail entry for a business-object action (create, edit,
 * approve, delete). Best-effort: a logging failure must never break the
 * real operation it's attached to, so errors are swallowed here (and
 * logged to stderr) rather than propagated to the caller.
 */
async function logAction({ organizationId, entityType, entityId, action, performedBy, metadata }) {
  try {
    await db.query(
      `INSERT INTO audit_log (organization_id, entity_type, entity_id, action, performed_by, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [organizationId, entityType, entityId, action, performedBy || null, metadata ? JSON.stringify(metadata) : null]
    );
  } catch (err) {
    console.error('Failed to write audit log entry:', err.message);
  }
}

module.exports = { logAction };

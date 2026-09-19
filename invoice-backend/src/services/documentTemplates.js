const db = require('../db');

// Most-specific-wins resolution: an insurance-specific template beats a
// service-specific one, which beats an industry-specific one, which beats
// the plain organization default. Returns null when nothing matches at
// all — callers fall back to whatever they already do (the existing
// generic invoice PDF renderer), so an org that never touches this feature
// sees zero behavior change.
const SCOPE_PRIORITY = ['insurance', 'service', 'industry', 'organization'];

async function resolveTemplateAssignment({ organizationId, category, serviceType, industryKey, insuranceCompany }) {
  const { rows } = await db.query(
    `SELECT ta.scope, ta.scope_value, ta.template_id, dt.status
     FROM template_assignments ta
     JOIN document_templates dt ON dt.id = ta.template_id
     WHERE ta.organization_id = $1 AND dt.category = $2 AND dt.status = 'active'`,
    [organizationId, category]
  );

  const candidatesByScope = { insurance: [], service: [], industry: [], organization: [] };
  for (const row of rows) {
    if (candidatesByScope[row.scope]) candidatesByScope[row.scope].push(row);
  }

  const matchers = {
    insurance: (row) => insuranceCompany && row.scope_value && row.scope_value.toLowerCase() === insuranceCompany.toLowerCase(),
    service: (row) => serviceType && row.scope_value && row.scope_value.toLowerCase() === serviceType.toLowerCase(),
    industry: (row) => industryKey && row.scope_value === industryKey,
    organization: () => true,
  };

  for (const scope of SCOPE_PRIORITY) {
    const match = candidatesByScope[scope].find(matchers[scope]);
    if (match) return match.template_id;
  }

  // The Test & Activate screen's simple "Use as default invoice"/"...job
  // or claim form" toggle is a flag on the template itself, not a row in
  // template_assignments (that table is for the more granular
  // service/industry/insurance scopes) — it's the organization-level
  // fallback, checked last, same as an explicit scope='organization'
  // assignment would be.
  const defaultColumn = category === 'job_claim' ? 'is_default_job_claim' : 'is_default_invoice';
  const { rows: defaultRows } = await db.query(
    `SELECT id FROM document_templates WHERE organization_id = $1 AND category = $2 AND status = 'active' AND ${defaultColumn} LIMIT 1`,
    [organizationId, category]
  );
  return defaultRows[0]?.id || null;
}

module.exports = { resolveTemplateAssignment };

// Trades where a flat "service call" / dispatch fee is a standard, expected
// line item — a technician travels to the customer's home or shop, often
// for insurance-adjacent work. Kept in sync with the backend's identical
// set in invoice-backend/src/utils/industryTemplates.js.
const SERVICE_CALL_FEE_INDUSTRIES = new Set(['appliance_repair', 'electrical', 'plumbing', 'hvac', 'auto_repair']);

export function allowsServiceCallFee(industryKey) {
  return SERVICE_CALL_FEE_INDUSTRIES.has(industryKey);
}

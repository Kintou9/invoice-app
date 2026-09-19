// Seed field configs for the 7 industry cards + general fallback shown
// during onboarding and used to pre-populate a new invoice_field_templates
// row. Materials/labor/parts are deliberately NOT modeled as template
// fields here — they're the existing shared invoice_line_items table,
// which every template already renders identically, so there is nothing
// industry-specific to add for them.
//
// One field shape for every industry: { id, label, type, section, visible,
// required, order, customerVisible }. The only thing that varies between
// industries is which of these get seeded — never a code branch.

function field(id, label, type, overrides = {}) {
  return {
    id,
    label,
    type,
    section: 'customer_job',
    visible: true,
    required: false,
    customerVisible: true,
    ...overrides,
  };
}

const INDUSTRY_TEMPLATES = {
  electrical: {
    label: 'Electrical',
    description: 'Materials, labor & service details',
    fields: [
      field('service_address', 'Service Address', 'text', { required: true, order: 10 }),
      field('work_area', 'Work Area', 'text', { section: 'details', order: 20 }),
      field('electrical_work_performed', 'Electrical Work Performed', 'textarea', { required: true, section: 'work', order: 30 }),
      field('circuit_panel_reference', 'Circuit/Panel Reference', 'text', { section: 'details', order: 40 }),
    ],
  },
  plumbing: {
    label: 'Plumbing',
    description: 'Fixtures, repairs & labor',
    fields: [
      field('fixture_system', 'Fixture/System', 'text', { required: true, order: 10 }),
      field('issue', 'Issue', 'textarea', { required: true, section: 'work', order: 20 }),
      field('repairs_performed', 'Repairs Performed', 'textarea', { section: 'work', order: 30 }),
    ],
  },
  appliance_repair: {
    label: 'Appliance Repair',
    description: 'Model, serial number & parts',
    fields: [
      field('appliance_type', 'Appliance Type', 'text', { required: true, order: 10 }),
      field('brand', 'Brand', 'text', { section: 'details', order: 20 }),
      field('model', 'Model', 'text', { section: 'details', order: 30 }),
      field('serial_number', 'Serial Number', 'text', { section: 'details', order: 40 }),
      field('diagnosis', 'Diagnosis', 'textarea', { required: true, section: 'work', order: 50 }),
    ],
  },
  auto_repair: {
    label: 'Auto Repair / Mechanic',
    description: 'Vehicle details, mileage & labor',
    fields: [
      field('vehicle_year', 'Vehicle Year', 'text', { section: 'details', order: 10 }),
      field('vehicle_make', 'Vehicle Make', 'text', { required: true, order: 20 }),
      field('vehicle_model', 'Vehicle Model', 'text', { required: true, order: 30 }),
      field('vin', 'VIN', 'text', { section: 'details', order: 40 }),
      field('mileage', 'Mileage', 'number', { section: 'details', order: 50 }),
      field('work_performed', 'Work Performed', 'textarea', { required: true, section: 'work', order: 60 }),
    ],
  },
  hvac: {
    label: 'HVAC',
    description: 'Equipment, diagnosis & parts',
    fields: [
      field('equipment_type', 'Equipment Type', 'text', { required: true, order: 10 }),
      field('brand', 'Brand', 'text', { section: 'details', order: 20 }),
      field('model', 'Model', 'text', { section: 'details', order: 30 }),
      field('serial_number', 'Serial Number', 'text', { section: 'details', order: 40 }),
      field('system_location', 'System Location', 'text', { section: 'details', order: 50 }),
      field('diagnosis', 'Diagnosis', 'textarea', { required: true, section: 'work', order: 60 }),
    ],
  },
  flooring: {
    label: 'Flooring, Drywall & Repairs',
    description: 'Measurements, materials & labor',
    fields: [
      field('work_area_room', 'Work Area/Room', 'text', { required: true, order: 10 }),
      field('measurements', 'Measurements & Units', 'text', { section: 'details', order: 20 }),
      field('preparation', 'Preparation', 'textarea', { section: 'work', order: 30 }),
      field('finish', 'Finish', 'text', { section: 'work', order: 40 }),
    ],
  },
  general: {
    label: 'General Services',
    description: 'A flexible template for any business',
    fields: [
      field('service_description', 'Service Description', 'textarea', { required: true, section: 'work', order: 10 }),
    ],
  },
};

// Trades where a flat "service call" / dispatch fee is a standard, expected
// line item — a technician travels to the customer's home or shop, often
// for insurance-adjacent work (a claim, a warranty repair). Project/quote
// trades (flooring) and the generic fallback don't have that convention, so
// the fee stays unavailable there rather than showing a stray $0 line.
const SERVICE_CALL_FEE_INDUSTRIES = new Set(['appliance_repair', 'electrical', 'plumbing', 'hvac', 'auto_repair']);

function allowsServiceCallFee(industryKey) {
  return SERVICE_CALL_FEE_INDUSTRIES.has(industryKey);
}

module.exports = { INDUSTRY_TEMPLATES, allowsServiceCallFee };

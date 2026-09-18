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
    section: 'job_details',
    visible: true,
    required: false,
    customerVisible: true,
    ...overrides,
  };
}

const INDUSTRY_TEMPLATES = {
  electrical: {
    label: 'Electrical',
    fields: [
      field('service_address', 'Service Address', 'text', { required: true, order: 10 }),
      field('work_area', 'Work Area', 'text', { order: 20 }),
      field('electrical_work_performed', 'Electrical Work Performed', 'textarea', { required: true, order: 30 }),
      field('circuit_panel_reference', 'Circuit/Panel Reference', 'text', { order: 40 }),
    ],
  },
  plumbing: {
    label: 'Plumbing',
    fields: [
      field('fixture_system', 'Fixture/System', 'text', { required: true, order: 10 }),
      field('issue', 'Issue', 'textarea', { required: true, order: 20 }),
      field('repairs_performed', 'Repairs Performed', 'textarea', { order: 30 }),
    ],
  },
  appliance_repair: {
    label: 'Appliance Repair',
    fields: [
      field('appliance_type', 'Appliance Type', 'text', { required: true, order: 10 }),
      field('brand', 'Brand', 'text', { order: 20 }),
      field('model', 'Model', 'text', { order: 30 }),
      field('serial_number', 'Serial Number', 'text', { order: 40 }),
      field('diagnosis', 'Diagnosis', 'textarea', { required: true, order: 50 }),
    ],
  },
  auto_repair: {
    label: 'Auto Repair / Mechanic',
    fields: [
      field('vehicle_year', 'Vehicle Year', 'text', { order: 10 }),
      field('vehicle_make', 'Vehicle Make', 'text', { required: true, order: 20 }),
      field('vehicle_model', 'Vehicle Model', 'text', { required: true, order: 30 }),
      field('vin', 'VIN', 'text', { order: 40 }),
      field('mileage', 'Mileage', 'number', { order: 50 }),
      field('work_performed', 'Work Performed', 'textarea', { required: true, order: 60 }),
    ],
  },
  hvac: {
    label: 'HVAC',
    fields: [
      field('equipment_type', 'Equipment Type', 'text', { required: true, order: 10 }),
      field('brand', 'Brand', 'text', { order: 20 }),
      field('model', 'Model', 'text', { order: 30 }),
      field('serial_number', 'Serial Number', 'text', { order: 40 }),
      field('system_location', 'System Location', 'text', { order: 50 }),
      field('diagnosis', 'Diagnosis', 'textarea', { required: true, order: 60 }),
    ],
  },
  flooring: {
    label: 'Flooring, Drywall & Repairs',
    fields: [
      field('work_area_room', 'Work Area/Room', 'text', { required: true, order: 10 }),
      field('measurements', 'Measurements & Units', 'text', { order: 20 }),
      field('preparation', 'Preparation', 'textarea', { order: 30 }),
      field('finish', 'Finish', 'text', { order: 40 }),
    ],
  },
  general: {
    label: 'General Services',
    fields: [
      field('service_description', 'Service Description', 'textarea', { required: true, order: 10 }),
    ],
  },
};

module.exports = { INDUSTRY_TEMPLATES };

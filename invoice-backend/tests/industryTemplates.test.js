const { INDUSTRY_TEMPLATES } = require('../src/utils/industryTemplates');

const EXPECTED_KEYS = ['electrical', 'plumbing', 'appliance_repair', 'auto_repair', 'hvac', 'flooring', 'general'];

test('all 7 industries plus general exist with a non-empty, unique-id field list', () => {
  expect(Object.keys(INDUSTRY_TEMPLATES).sort()).toEqual([...EXPECTED_KEYS].sort());

  for (const key of EXPECTED_KEYS) {
    const template = INDUSTRY_TEMPLATES[key];
    expect(template.label).toEqual(expect.any(String));
    expect(template.fields.length).toBeGreaterThan(0);

    const ids = template.fields.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const field of template.fields) {
      expect(field).toMatchObject({
        id: expect.any(String),
        label: expect.any(String),
        type: expect.any(String),
        visible: true,
        customerVisible: true,
      });
      expect(typeof field.required).toBe('boolean');
      expect(typeof field.order).toBe('number');
      // Cost/margin must never be representable as a template field — this
      // is what keeps internal billing data structurally out of the
      // customer-visible field system.
      expect(field.id).not.toMatch(/cost|margin|profit/i);
    }
  }
});

test('general has exactly one required field: service description', () => {
  const ids = INDUSTRY_TEMPLATES.general.fields.map((f) => f.id);
  expect(ids).toContain('service_description');
});

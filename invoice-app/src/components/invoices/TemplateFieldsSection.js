export default function TemplateFieldsSection({ snapshot, values, onChange, isEditable }) {
  const fields = [...(snapshot?.fields || [])].filter((f) => f.visible).sort((a, b) => (a.order || 0) - (b.order || 0));
  if (fields.length === 0) return null;

  return (
    <section className="card">
      <h2>Job Details</h2>
      <div className="form-row" style={{ flexWrap: 'wrap' }}>
        {fields.map((f) => (
          <div className="form-group" key={f.id} style={{ minWidth: 220 }}>
            <label htmlFor={`field-${f.id}`}>{f.label}{f.required ? ' *' : ''}</label>
            {f.type === 'textarea' ? (
              <textarea
                id={`field-${f.id}`}
                rows={3}
                value={values[f.id] || ''}
                onChange={(e) => onChange(f.id, e.target.value)}
                disabled={!isEditable}
                required={f.required}
              />
            ) : (
              <input
                id={`field-${f.id}`}
                type={f.type === 'number' ? 'number' : 'text'}
                value={values[f.id] || ''}
                onChange={(e) => onChange(f.id, e.target.value)}
                disabled={!isEditable}
                required={f.required}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

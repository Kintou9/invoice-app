import { useEffect, useState } from 'react';
import api from '../../services/api';
import './BusinessTypeStep.css';

export default function BusinessTypeStep({ selectedKey, onSelect, onContinue, onUseGeneral }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = () => {
    setLoading(true);
    setError(false);
    api.get('/onboarding/business-types')
      .then((r) => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading) return <p>Loading business types...</p>;
  if (error) return (
    <div className="onboarding-error">
      <p>Couldn't load business types.</p>
      <button className="btn btn-secondary" onClick={load}>Retry</button>
    </div>
  );

  const selected = [...data.businessTypes, data.general].find((t) => t.key === selectedKey);

  return (
    <div className="business-type-step">
      <h1>What kind of work does your business do?</h1>
      <p className="business-type-subtitle">Choose a starting point. You can customize everything later.</p>

      <div className="business-type-grid" role="radiogroup" aria-label="Business type">
        {data.businessTypes.map((t) => (
          <button
            key={t.key}
            type="button"
            role="radio"
            aria-checked={selectedKey === t.key}
            className={`business-type-card ${selectedKey === t.key ? 'selected' : ''}`}
            onClick={() => onSelect(t.key, t.fields)}
          >
            <span className="business-type-card-label">{t.label}</span>
            <span className="business-type-card-count">{t.fields.length} suggested fields</span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="business-type-preview">
          <h3>Suggested fields for {selected.label}</h3>
          <ul>
            {selected.fields.map((f) => (
              <li key={f.id}>{f.label}{f.required ? ' (required)' : ''}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="business-type-actions">
        <button type="button" className="btn btn-secondary" onClick={() => onUseGeneral(data.general.key, data.general.fields)}>
          Use a general template
        </button>
        <button type="button" className="btn btn-primary" onClick={onContinue} disabled={!selectedKey}>
          Continue
        </button>
      </div>
    </div>
  );
}

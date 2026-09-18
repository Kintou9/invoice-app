import { useEffect, useState } from 'react';
import api from '../../services/api';
import { Zap, Droplet, WashingMachine, Car, Fan, PaintRoller, Wrench, Paperclip } from 'lucide-react';
import './BusinessTypeStep.css';

const ICONS = {
  electrical: Zap,
  plumbing: Droplet,
  appliance_repair: WashingMachine,
  auto_repair: Car,
  hvac: Fan,
  flooring: PaintRoller,
  general: Wrench,
};

const SECTION_LABELS = { customer_job: 'Customer & Job', details: 'Details', work: 'Work Performed' };

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

  const allTypes = [...data.businessTypes, data.general];
  const selected = allTypes.find((t) => t.key === selectedKey);
  const groupedFields = selected
    ? Object.entries(
        selected.fields.reduce((groups, f) => {
          (groups[f.section] = groups[f.section] || []).push(f);
          return groups;
        }, {})
      )
    : [];

  return (
    <div className="business-type-step">
      <h1>What kind of work does your business do?</h1>
      <p className="business-type-subtitle">Choose a starting point. You can customize everything later.</p>

      <div className="business-type-layout">
        <div className="business-type-grid" role="radiogroup" aria-label="Business type">
          {allTypes.map((t) => {
            const Icon = ICONS[t.key] || Wrench;
            const isSelected = selectedKey === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="radio"
                aria-checked={isSelected}
                className={`business-type-card ${isSelected ? 'selected' : ''} ${t.key === 'general' ? 'business-type-card-wide' : ''}`}
                onClick={() => onSelect(t.key, t.fields)}
              >
                <span className="business-type-card-top">
                  <Icon size={26} strokeWidth={1.5} />
                  <span className={`business-type-radio ${isSelected ? 'checked' : ''}`} aria-hidden="true" />
                </span>
                <span className="business-type-card-label">{t.label}</span>
                <span className="business-type-card-description">{t.description}</span>
              </button>
            );
          })}
        </div>

        {selected && (
          <aside className="business-type-preview">
            <div className="business-type-preview-badge">Your starting template</div>
            <div className="business-type-preview-body">
              <h3>{selected.label}</h3>
              <div className="business-type-preview-invoice">
                <div className="business-type-preview-row">
                  <span className="business-type-preview-fake-input business-type-preview-fake-input-wide" />
                  <span className="business-type-preview-invoice-id">Invoice<br />#0001</span>
                </div>
                {groupedFields.map(([section, fields]) => (
                  <div key={section} className="business-type-preview-section">
                    <h4>{SECTION_LABELS[section] || section}</h4>
                    {fields.map((f) => (
                      <div key={f.id} className="business-type-preview-field">
                        <label>{f.label}</label>
                        <span className="business-type-preview-fake-input" />
                      </div>
                    ))}
                  </div>
                ))}
                <div className="business-type-preview-section">
                  <h4>Line Items</h4>
                  <div className="business-type-preview-line-items">
                    <div className="business-type-preview-line-item-header">
                      <span>Item</span><span>Qty</span><span>Rate</span><span>Amount</span>
                    </div>
                    <div className="business-type-preview-line-item"><span>Parts</span><span /><span /><span /></div>
                    <div className="business-type-preview-line-item"><span>Labor</span><span /><span /><span /></div>
                    <div className="business-type-preview-total"><span>Total</span><span>$0.00</span></div>
                  </div>
                </div>
              </div>
            </div>
            <div className="business-type-preview-footer">
              <Paperclip size={13} />
              Every template includes invoices, attachments, and notes.
            </div>
          </aside>
        )}
      </div>

      <div className="business-type-actions">
        <button type="button" className="business-type-link" onClick={() => onUseGeneral(data.general.key, data.general.fields)}>
          Use a general template
        </button>
        <div className="business-type-continue">
          <button type="button" className="btn btn-primary" onClick={onContinue} disabled={!selectedKey}>
            Continue →
          </button>
          <span className="business-type-continue-hint">You can add more templates later.</span>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import BusinessTypeStep from '../components/onboarding/BusinessTypeStep';
import CustomizeStep from '../components/onboarding/CustomizeStep';
import './OnboardingPage.css';

const DEFAULT_FEATURES = { claim_number: false, po_reference: false, photos: true, receipts: false, notes: true };

function draftFromTemplate(t) {
  return {
    name: t.name || '', contact_name: t.contact_name || '', contact_email: t.contact_email || '',
    contact_phone: t.contact_phone || '', contact_address: t.contact_address || '',
    payment_terms: t.payment_terms || '', tax_rate: t.tax_rate ?? 0,
    optional_features: t.optional_features || DEFAULT_FEATURES,
    fields: t.fields || [], logo_blob_url: t.logo_blob_url || null, logo_sas_url: t.logo_sas_url || null,
  };
}

export default function OnboardingPage() {
  const { refreshUser } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState('business_type');
  const [businessType, setBusinessType] = useState('');
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/onboarding/status').then((r) => {
      const { onboarding_status, onboarding_step, onboarding_business_type } = r.data;
      if (onboarding_status === 'completed') {
        navigate('/dashboard', { replace: true });
        return;
      }
      // The wizard only saves progress at step/business-type granularity —
      // a template row (and with it, the finer-grained field edits) is only
      // ever created by POST /complete or /skip, which immediately finishes
      // onboarding, so there's never a persisted mid-customize draft to
      // resume into. A refresh mid-customize re-derives a fresh draft from
      // the chosen business type below rather than resuming lost edits.
      if (onboarding_step) setStep(onboarding_step);
      if (onboarding_business_type) setBusinessType(onboarding_business_type);
    }).catch(() => toast.error('Could not load onboarding progress')).finally(() => setLoading(false));
  }, [navigate]);

  const goToCustomize = (key, fields) => {
    setBusinessType(key);
    setDraft(draftFromTemplate({ fields, tax_rate: 0, optional_features: DEFAULT_FEATURES }));
    setStep('customize');
    api.patch('/onboarding', { step: 'customize', business_type: key }).catch(() => {});
  };

  const handleSelect = (key) => {
    setBusinessType(key);
    api.patch('/onboarding', { business_type: key }).catch(() => {});
  };

  const handleContinue = () => {
    api.get('/onboarding/business-types').then((r) => {
      const all = [...r.data.businessTypes, r.data.general];
      const chosen = all.find((t) => t.key === businessType);
      goToCustomize(businessType, chosen?.fields || []);
    });
  };

  const handleUseGeneral = (key, fields) => goToCustomize(key, fields);

  const finish = async (body) => {
    setSaving(true);
    try {
      await api.post('/onboarding/complete', body);
      await refreshUser();
      navigate('/dashboard', { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not finish setup');
    } finally {
      setSaving(false);
    }
  };

  const handleUseDefaults = () => finish({ business_type: businessType });

  const handleSaveAndContinue = () => finish({
    business_type: businessType,
    name: draft.name, fields: draft.fields, optional_features: draft.optional_features,
    payment_terms: draft.payment_terms, tax_rate: draft.tax_rate,
    contact_name: draft.contact_name, contact_email: draft.contact_email,
    contact_phone: draft.contact_phone, contact_address: draft.contact_address,
    logo_blob_url: draft.logo_blob_url,
  });

  if (loading) return <div className="loading-screen">Loading...</div>;

  return (
    <div className="onboarding-page">
      <div className="onboarding-shell">
        <div className="onboarding-steps-indicator">
          <span className={step === 'business_type' ? 'active' : 'done'}>1. Business type</span>
          <span className={step === 'customize' ? 'active' : ''}>2. Customize</span>
        </div>

        {step === 'business_type' ? (
          <BusinessTypeStep selectedKey={businessType} onSelect={handleSelect} onContinue={handleContinue} onUseGeneral={handleUseGeneral} />
        ) : (
          draft && (
            <CustomizeStep
              draft={draft}
              onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
              onUseDefaults={handleUseDefaults}
              onSaveAndContinue={handleSaveAndContinue}
              saving={saving}
            />
          )
        )}
      </div>
    </div>
  );
}
